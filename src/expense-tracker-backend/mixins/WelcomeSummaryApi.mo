import Map "mo:core/Map";
import List "mo:core/List";
import Types "../types";
import Principal "mo:core/Principal";
import Time "mo:core/Time";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Iter "mo:core/Iter";
import Nat "mo:core/Nat";
import Int "mo:core/Int";
import AccessLib "../lib/access";

// "Co nowego od ostatniego logowania" — Faza 2 planu Agenta AI. Zero LLM:
// czyste porównania timestampów (createdAt > ostatnie logowanie) plus
// nadchodzące ważne daty z kalendarza w ciągu 7 dni. Modal wywołuje
// getWelcomeSummary() przy starcie, potem markWelcomeSeen() po zamknięciu.
mixin (
  orders : Map.Map<Nat, Types.Order>,
  ordersTrashed : Map.Map<Nat, Int>,
  contracts : Map.Map<Nat, Types.Contract>,
  contractsTrashed : Map.Map<Nat, Int>,
  calendarEvents : Map.Map<Nat, Types.CalendarEvent>,
  calendarEventsTrashed : Map.Map<Nat, Int>,
  pendingInvoices : Map.Map<Text, Types.PendingInvoice>,
  userLastSeen : Map.Map<Principal, Int>,
  accessRoles : Map.Map<Principal, Types.Role>,
  moduleAccess : Map.Map<Principal, [Text]>,
) {
  let NS_PER_DAY : Int = 24 * 60 * 60 * 1_000_000_000;
  let UPCOMING_WINDOW_DAYS : Int = 7;

  func requireWelcomeAccess(caller : Principal) {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
  };

  // Howard Hinnant's days_from_civil — converts a (year, month, day) civil
  // date into days since 1970-01-01. Only this direction is needed since we
  // only ever compare two "days since epoch" integers.
  func daysFromCivil(y : Int, m : Int, d : Int) : Int {
    let y2 = if (m <= 2) { y - 1 } else { y };
    let era = if (y2 >= 0) { y2 / 400 } else { (y2 - 399) / 400 };
    let yoe = y2 - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468;
  };

  // Parses "YYYY-MM-DD" (the <input type="date"> format used by the
  // calendar module). Returns null on anything unexpected rather than
  // trapping — a malformed date just gets silently skipped.
  func parseIsoDateToDays(s : Text) : ?Int {
    let parts = Iter.toArray(Text.split(s, #char '-'));
    if (parts.size() != 3) { return null; };
    let y = Nat.fromText(parts[0]);
    let m = Nat.fromText(parts[1]);
    let d = Nat.fromText(parts[2]);
    switch (y, m, d) {
      case (?y2, ?m2, ?d2) { ?daysFromCivil(Int.fromNat(y2), Int.fromNat(m2), Int.fromNat(d2)) };
      case (_, _, _) { null };
    };
  };

  public query ({ caller }) func getWelcomeSummary() : async [Types.WelcomeItem] {
    requireWelcomeAccess(caller);
    var result = List.empty<Types.WelcomeItem>();
    let lastSeen = switch (userLastSeen.get(caller)) {
      case (?t) { t };
      case null { 0 };
    };

    let canOrders = AccessLib.hasModuleAccess(moduleAccess, caller, "orders");
    let canContracts = AccessLib.hasModuleAccess(moduleAccess, caller, "contracts");
    let canCalendar = AccessLib.hasModuleAccess(moduleAccess, caller, "calendar");
    let canKsef = AccessLib.hasModuleAccess(moduleAccess, caller, "ksef");

    for ((id, o) in orders.entries()) {
      if (canOrders and ordersTrashed.get(id) == null and o.createdAt > lastSeen) {
        result.add({
          kind = #newOrder;
          entityRef = Nat.toText(id);
          entityLabel = "Zamówienie #" # Nat.toText(id) # " (" # o.name # ")";
          detail = "Nowe zamówienie od Twojego ostatniego logowania.";
        });
      };
    };

    for ((id, c) in contracts.entries()) {
      if (canContracts and contractsTrashed.get(id) == null and c.createdAt > lastSeen) {
        result.add({
          kind = #newContract;
          entityRef = Nat.toText(id);
          entityLabel = "Kontrakt #" # Nat.toText(id) # " (" # c.title # ")";
          detail = "Nowy kontrakt od Twojego ostatniego logowania.";
        });
      };
    };

    for ((id, e) in calendarEvents.entries()) {
      if (canCalendar and calendarEventsTrashed.get(id) == null and e.createdAt > lastSeen) {
        result.add({
          kind = #newCalendarEvent;
          entityRef = Nat.toText(id);
          entityLabel = "Kalendarz: " # e.title;
          detail = "Nowe wydarzenie/zadanie dodane od Twojego ostatniego logowania.";
        });
      };
    };

    for ((ksefNumber, inv) in pendingInvoices.entries()) {
      if (canKsef and inv.importedAt > lastSeen) {
        result.add({
          kind = #newKsefInvoice;
          entityRef = ksefNumber;
          entityLabel = "Faktura KSeF " # inv.invoiceNumber # " (" # inv.sellerName # ")";
          detail = "Nowa faktura z KSeF od Twojego ostatniego logowania.";
        });
      };
    };

    let nowDays = Time.now() / NS_PER_DAY;
    for ((id, e) in calendarEvents.entries()) {
      let isImportant = switch (e.eventType) { case (#importantDate) { true }; case (_) { false } };
      if (canCalendar and calendarEventsTrashed.get(id) == null and isImportant and not e.done) {
        switch (parseIsoDateToDays(e.startDate)) {
          case (?eventDays) {
            let diff = eventDays - nowDays;
            if (diff >= 0 and diff <= UPCOMING_WINDOW_DAYS) {
              result.add({
                kind = #upcomingImportantDate;
                entityRef = Nat.toText(id);
                entityLabel = "Ważna data: " # e.title;
                detail = if (diff == 0) { "Dzisiaj (" # e.startDate # ")" } else { "Za " # Int.toText(diff) # " dni (" # e.startDate # ")" };
              });
            };
          };
          case null {};
        };
      };
    };

    result.toArray();
  };

  public shared ({ caller }) func markWelcomeSeen() : async () {
    requireWelcomeAccess(caller);
    userLastSeen.add(caller, Time.now());
  };
};
