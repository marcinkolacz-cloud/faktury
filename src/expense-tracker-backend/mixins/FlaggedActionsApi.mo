import Map "mo:core/Map";
import List "mo:core/List";
import Types "../types";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Time "mo:core/Time";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import Float "mo:core/Float";
import AccessLib "../lib/access";

// "Zaległe akcje" — Faza 1 planu Agenta AI. Czysto deterministyczne reguły,
// zero wywołań LLM i zero outcalli, więc zero dodatkowego kosztu cykli poza
// zwykłym query call. Rozszerzaj listę reguł tutaj w miarę potrzeb.
mixin (
  orders : Map.Map<Nat, Types.Order>,
  ordersTrashed : Map.Map<Nat, Int>,
  orderDriveFolders : Map.Map<Nat, Text>,
  orderProductionEstimates : Map.Map<Nat, Text>,
  contracts : Map.Map<Nat, Types.Contract>,
  contractsTrashed : Map.Map<Nat, Int>,
  contractDriveFolders : Map.Map<Nat, Text>,
  expenses : Map.Map<Nat, Types.Expense>,
  expensesTrashed : Map.Map<Nat, Int>,
  pendingInvoices : Map.Map<Text, Types.PendingInvoice>,
  accessRoles : Map.Map<Principal, Types.Role>,
  moduleAccess : Map.Map<Principal, [Text]>,
) {
  let KSEF_PENDING_TOO_LONG_NS : Int = 7 * 24 * 60 * 60 * 1_000_000_000; // 7 dni

  public query ({ caller }) func getFlaggedActions() : async [Types.FlaggedAction] {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Admin access required"); };
    var result = List.empty<Types.FlaggedAction>();
    let canOrders = AccessLib.hasModuleAccess(moduleAccess, caller, "orders");
    let canContracts = AccessLib.hasModuleAccess(moduleAccess, caller, "contracts");
    let canInvoices = AccessLib.hasModuleAccess(moduleAccess, caller, "invoices");
    let canKsef = AccessLib.hasModuleAccess(moduleAccess, caller, "ksef");

    for ((id, o) in orders.entries()) {
      let isPending = switch (o.status) { case (#pending) { true }; case (_) { false } };
      if (canOrders and ordersTrashed.get(id) == null and isPending and orderDriveFolders.get(id) == null) {
        result.add({
          kind = #orderMissingDriveFolder;
          entityRef = Nat.toText(id);
          entityLabel = "Zamówienie #" # Nat.toText(id) # " (" # o.name # ")";
          detail = "Zamówienie w toku bez podpiętego folderu OneDrive.";
        });
      };
      if (canOrders and ordersTrashed.get(id) == null and isPending and orderProductionEstimates.get(id) == null) {
        result.add({
          kind = #orderMissingProductionEstimate;
          entityRef = Nat.toText(id);
          entityLabel = "Zamówienie #" # Nat.toText(id) # " (" # o.name # ")";
          detail = "Zamówiono, ale nie podano przewidywanego czasu produkcji/dostawy.";
        });
      };
    };

    for ((id, c) in contracts.entries()) {
      if (canContracts and contractsTrashed.get(id) == null and contractDriveFolders.get(id) == null) {
        result.add({
          kind = #contractMissingDriveFolder;
          entityRef = Nat.toText(id);
          entityLabel = "Kontrakt #" # Nat.toText(id) # " (" # c.title # ")";
          detail = "Kontrakt bez podpiętego folderu OneDrive.";
        });
      };
    };

    for ((id, e) in expenses.entries()) {
      if (canInvoices and expensesTrashed.get(id) == null and not e.hasInvoice and not e.paid) {
        result.add({
          kind = #expenseMissingInvoice;
          entityRef = Nat.toText(id);
          entityLabel = "Wydatek #" # Nat.toText(id) # " (" # e.productService # ")";
          detail = "Wydatek bez faktury i nieopłacony.";
        });
      };
    };

    let now = Time.now();
    for ((ksefNumber, inv) in pendingInvoices.entries()) {
      let isPending = switch (inv.status) { case (#pending) { true }; case (_) { false } };
      if (canKsef and isPending and (now - inv.importedAt) > KSEF_PENDING_TOO_LONG_NS) {
        result.add({
          kind = #ksefInvoicePendingTooLong;
          entityRef = ksefNumber;
          entityLabel = "Faktura KSeF " # inv.invoiceNumber # " (" # inv.sellerName # ")";
          detail = "Czeka na decyzję (dodanie do magazynu / odrzucenie) ponad 7 dni.";
        });
      };
    };

    // Anomalie kwot — Faza 3: >2 odchylenia standardowe od średniej dla
    // danego dostawcy. Zero LLM, zwykła statystyka; wymaga min. 3 wcześniej
    // wycenionych wydatków od tego dostawcy, inaczej odchylenie nie ma sensu.
    var supplierAmounts = Map.empty<Text, List.List<(Nat, Float)>>();
    for ((id, e) in expenses.entries()) {
      if (canInvoices and expensesTrashed.get(id) == null) {
        switch (e.pricePln) {
          case (?amount) {
            let bucket = switch (supplierAmounts.get(e.supplier)) {
              case (?l) { l };
              case null {
                let l = List.empty<(Nat, Float)>();
                supplierAmounts.add(e.supplier, l);
                l;
              };
            };
            bucket.add((id, amount));
          };
          case null {};
        };
      };
    };

    func fmtPln(f : Float) : Text { Float.toText(Float.nearest(f)); };

    for ((supplier, bucket) in supplierAmounts.entries()) {
      let arr = bucket.toArray();
      let n = arr.size();
      if (n >= 3) {
        var sum : Float = 0;
        for ((_, amt) in arr.vals()) { sum += amt; };
        let mean = sum / Float.fromInt(n);
        var sqSum : Float = 0;
        for ((_, amt) in arr.vals()) { let diff = amt - mean; sqSum += diff * diff; };
        let stddev = Float.sqrt(sqSum / Float.fromInt(n));
        if (stddev > 0) {
          let threshold = mean + 2 * stddev;
          for ((id, amt) in arr.vals()) {
            if (amt > threshold) {
              result.add({
                kind = #expenseAmountAnomaly;
                entityRef = Nat.toText(id);
                entityLabel = "Wydatek #" # Nat.toText(id) # " (" # supplier # ")";
                detail = "Kwota " # fmtPln(amt) # " PLN znacznie przekracza średnią dla tego dostawcy (śr. " # fmtPln(mean) # " PLN, odch. std " # fmtPln(stddev) # ").";
              });
            };
          };
        };
      };
    };

    result.toArray();
  };

  // Zapisuje odpowiedź na pytanie agenta "jaki przewidywany czas produkcji?"
  // — osobna mapa równoległa do Order (nigdy nie retypujemy istniejącego
  // stabilnego pola), więc bezpieczne przy upgrade.
  public shared ({ caller }) func setOrderProductionEstimate(orderId : Nat, estimate : Text) : async () {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Admin access required"); };
    orderProductionEstimates.add(orderId, estimate);
  };
};
