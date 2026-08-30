import Map "mo:core/Map";
import List "mo:core/List";
import Types "../types";
import Principal "mo:core/Principal";
import Time "mo:core/Time";
import Runtime "mo:core/Runtime";
import Nat "mo:core/Nat";
import AccessLib "../lib/access";
import InvitesLib "../lib/invites";
import Array "mo:core/Array";
import Text "mo:core/Text";
import AuditLib "../lib/audit";

mixin (
  tickets : Map.Map<Nat, Types.Ticket>,
  accessRoles : Map.Map<Principal, Types.Role>,
  recentSubmissionTimes : List.List<Int>,
  ticketTokens : Map.Map<Text, Nat>,
  ticketExtras : Map.Map<Nat, Types.TicketExtras>,
  ticketArchived : Map.Map<Nat, Bool>,
  ticketSeenCounts : Map.Map<Nat, Nat>,
  recentClientReplyTimes : List.List<Int>,
  moduleAccess : Map.Map<Principal, [Text]>,
  ticketsTrashed : Map.Map<Nat, Int>,
  auditLog : List.List<Types.AuditEntry>,
) {
  public shared func submitTicket(
    clientName : Text,
    clientEmail : Text,
    subject : Text,
    description : Text,
    honeypot : Text,
    company : Text,
    deviceNumber : Text,
  ) : async (Nat, Text) {
    if (honeypot != "") { Runtime.trap("Rejected"); };

    let now = Time.now();
    let oneMinuteAgo : Int = now - 60_000_000_000;
    var stillValid = List.empty<Int>();
    for (t in recentSubmissionTimes.values()) {
      if (t > oneMinuteAgo) { stillValid.add(t); };
    };
    if (stillValid.size() >= 5) { Runtime.trap("Rate limit exceeded, try again later"); };
    stillValid.add(now);
    recentSubmissionTimes.clear();
    for (t in stillValid.values()) { recentSubmissionTimes.add(t); };

    let newId = tickets.size();
    let tokenPart1 = await InvitesLib.generateRandomCode();
    let tokenPart2 = await InvitesLib.generateRandomCode();
    let trackingToken = tokenPart1 # tokenPart2;
    let ticket : Types.Ticket = {
      id = newId;
      clientName;
      clientEmail;
      subject;
      description;
      status = #open_;
      replies = [];
      createdAt = Time.now();
    };
    tickets.add(newId, ticket);
    ticketTokens.add(trackingToken, newId);
    ticketExtras.add(newId, { company; deviceNumber });
    (newId, trackingToken);
  };

  // Zgłoszenie wprowadzane wewnętrznie przez pracownika (np. klient zgłosił
  // usterkę telefonicznie) — te same pola co formularz publiczny, ale bez
  // honeypotu/limitu 5/min (autoryzowany caller) i z wpisem w audit logu.
  public shared ({ caller }) func submitInternalTicket(
    clientName : Text,
    clientEmail : Text,
    subject : Text,
    description : Text,
    company : Text,
    deviceNumber : Text,
  ) : async (Nat, Text) {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "tickets")) { Runtime.trap("Module access required: tickets"); };

    let newId = tickets.size();
    let tokenPart1 = await InvitesLib.generateRandomCode();
    let tokenPart2 = await InvitesLib.generateRandomCode();
    let trackingToken = tokenPart1 # tokenPart2;
    let ticket : Types.Ticket = {
      id = newId;
      clientName;
      clientEmail;
      subject;
      description;
      status = #open_;
      replies = [];
      createdAt = Time.now();
    };
    tickets.add(newId, ticket);
    ticketTokens.add(trackingToken, newId);
    ticketExtras.add(newId, { company; deviceNumber });
    AuditLib.record(auditLog, caller, "ticket_created_internal", "Zgłoszenie #" # Nat.toText(newId) # " (" # clientName # ")");
    (newId, trackingToken);
  };

  public query ({ caller }) func listTicketExtras() : async [(Nat, Types.TicketExtras)] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "tickets")) { Runtime.trap("Module access required: tickets"); };
    var result = List.empty<(Nat, Types.TicketExtras)>();
    for ((id, extras) in ticketExtras.entries()) {
      result.add((id, extras));
    };
    result.toArray();
  };

  public query ({ caller }) func listTicketTokens() : async [(Text, Nat)] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "tickets")) { Runtime.trap("Module access required: tickets"); };
    var result = List.empty<(Text, Nat)>();
    for ((token, id) in ticketTokens.entries()) {
      result.add((token, id));
    };
    result.toArray();
  };

  public query ({ caller }) func getTicketTrackingToken(id : Nat) : async ?Text {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "tickets")) { Runtime.trap("Module access required: tickets"); };
    var found : ?Text = null;
    for ((token, ticketId) in ticketTokens.entries()) {
      if (ticketId == id) { found := ?token; };
    };
    found;
  };

  public query func getTicketByToken(token : Text) : async ?Types.PublicTicketView {
    let ticketId = ticketTokens.get(token);
    let found = switch (ticketId) {
      case (?id) { tickets.get(id) };
      case null { null };
    };
    switch (found) {
      case (?t) {
        let publicReplies = Array.filter<Types.TicketReply>(t.replies, func(r : Types.TicketReply) : Bool { not r.isInternal });
        let extras = switch (ticketExtras.get(t.id)) {
          case (?e) { e };
          case null { { company = ""; deviceNumber = "" } };
        };
        ?{
          id = t.id;
          subject = t.subject;
          description = t.description;
          status = t.status;
          replies = publicReplies;
          createdAt = t.createdAt;
          company = extras.company;
          deviceNumber = extras.deviceNumber;
        };
      };
      case null { null };
    };
  };

  public shared ({ caller }) func importTickets(rows : [Types.Ticket], overwrite : Bool) : async Nat {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can import data"); };
    var count = 0;
    for (t in rows.vals()) {
      switch (tickets.get(t.id)) {
        case (?_) { if (overwrite) { tickets.add(t.id, t); count += 1; }; };
        case null { tickets.add(t.id, t); count += 1; };
      };
    };
    count;
  };

  public shared ({ caller }) func importTicketExtras(rows : [(Nat, Types.TicketExtras)], overwrite : Bool) : async Nat {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can import data"); };
    var count = 0;
    for ((id, extras) in rows.vals()) {
      switch (ticketExtras.get(id)) {
        case (?_) { if (overwrite) { ticketExtras.add(id, extras); count += 1; }; };
        case null { ticketExtras.add(id, extras); count += 1; };
      };
    };
    count;
  };

  public shared ({ caller }) func importTicketArchived(rows : [Nat], overwrite : Bool) : async Nat {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can import data"); };
    var count = 0;
    for (id in rows.vals()) {
      switch (ticketArchived.get(id)) {
        case (?_) { if (overwrite) { ticketArchived.add(id, true); count += 1; }; };
        case null { ticketArchived.add(id, true); count += 1; };
      };
    };
    count;
  };

  public shared ({ caller }) func importTicketSeenCounts(rows : [(Nat, Nat)], overwrite : Bool) : async Nat {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can import data"); };
    var count = 0;
    for ((id, seenCount) in rows.vals()) {
      switch (ticketSeenCounts.get(id)) {
        case (?_) { if (overwrite) { ticketSeenCounts.add(id, seenCount); count += 1; }; };
        case null { ticketSeenCounts.add(id, seenCount); count += 1; };
      };
    };
    count;
  };

  public shared ({ caller }) func importTicketTokens(rows : [(Text, Nat)], overwrite : Bool) : async Nat {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can import data"); };
    var count = 0;
    for ((token, id) in rows.vals()) {
      switch (ticketTokens.get(token)) {
        case (?_) { if (overwrite) { ticketTokens.add(token, id); count += 1; }; };
        case null { ticketTokens.add(token, id); count += 1; };
      };
    };
    count;
  };

  public query ({ caller }) func listTickets() : async [Types.Ticket] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "tickets")) { Runtime.trap("Module access required: tickets"); };
    var result = List.empty<Types.Ticket>();
    for ((id, t) in tickets.entries()) {
      if (ticketsTrashed.get(id) == null) { result.add(t); };
    };
    result.toArray();
  };

  public shared ({ caller }) func trashTicket(id : Nat) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "tickets")) { Runtime.trap("Module access required: tickets"); };
    switch (tickets.get(id)) {
      case (?_) {
        ticketsTrashed.add(id, Time.now());
        AuditLib.record(auditLog, caller, "ticket_trashed", "Zgłoszenie #" # Nat.toText(id));
        true;
      };
      case null { false };
    };
  };

  public shared ({ caller }) func restoreTicket(id : Nat) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "tickets")) { Runtime.trap("Module access required: tickets"); };
    switch (ticketsTrashed.get(id)) {
      case (?_) {
        ticketsTrashed.remove(id);
        AuditLib.record(auditLog, caller, "ticket_restored", "Zgłoszenie #" # Nat.toText(id));
        true;
      };
      case null { false };
    };
  };

  public shared ({ caller }) func permanentlyDeleteTicket(id : Nat) : async Bool {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can permanently delete"); };
    ticketArchived.remove(id);
    ticketSeenCounts.remove(id);
    ticketExtras.remove(id);
    ticketsTrashed.remove(id);
    switch (tickets.get(id)) {
      case (?_) { tickets.remove(id); true; };
      case null { false };
    };
  };

  public query ({ caller }) func listTrashedTickets() : async [Types.Ticket] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "tickets")) { Runtime.trap("Module access required: tickets"); };
    var result = List.empty<Types.Ticket>();
    for ((id, _) in ticketsTrashed.entries()) {
      switch (tickets.get(id)) {
        case (?t) { result.add(t); };
        case null {};
      };
    };
    result.toArray();
  };

  public shared ({ caller }) func updateTicketStatus(id : Nat, status : Types.TicketStatus) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "tickets")) { Runtime.trap("Module access required: tickets"); };
    switch (tickets.get(id)) {
      case (?t) {
        tickets.add(id, { t with status });
        true;
      };
      case null { false };
    };
  };

  public shared ({ caller }) func addTicketReply(id : Nat, author : Text, message : Text, isInternal : Bool) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "tickets")) { Runtime.trap("Module access required: tickets"); };
    switch (tickets.get(id)) {
      case (?t) {
        let newReply : Types.TicketReply = { author; message; isInternal; createdAt = Time.now() };
        let updatedReplies = List.fromArray<Types.TicketReply>(t.replies);
        updatedReplies.add(newReply);
        tickets.add(id, { t with replies = updatedReplies.toArray() });
        true;
      };
      case null { false };
    };
  };

  public shared func addClientReply(token : Text, message : Text, honeypot : Text) : async Bool {
    if (honeypot != "") { Runtime.trap("Rejected"); };

    let now = Time.now();
    let oneMinuteAgo : Int = now - 60_000_000_000;
    var stillValid = List.empty<Int>();
    for (t in recentClientReplyTimes.values()) {
      if (t > oneMinuteAgo) { stillValid.add(t); };
    };
    if (stillValid.size() >= 5) { Runtime.trap("Rate limit exceeded, try again later"); };
    stillValid.add(now);
    recentClientReplyTimes.clear();
    for (t in stillValid.values()) { recentClientReplyTimes.add(t); };

    switch (ticketTokens.get(token)) {
      case (?id) {
        switch (tickets.get(id)) {
          case (?t) {
            let newReply : Types.TicketReply = {
              author = t.clientName;
              message;
              isInternal = false;
              createdAt = Time.now();
            };
            let updatedReplies = List.fromArray<Types.TicketReply>(t.replies);
            updatedReplies.add(newReply);
            tickets.add(id, { t with replies = updatedReplies.toArray() });
            true;
          };
          case null { false };
        };
      };
      case null { false };
    };
  };

  public shared ({ caller }) func archiveTicket(id : Nat) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "tickets")) { Runtime.trap("Module access required: tickets"); };
    switch (tickets.get(id)) {
      case (?_) { ticketArchived.add(id, true); true };
      case null { false };
    };
  };

  public shared ({ caller }) func unarchiveTicket(id : Nat) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "tickets")) { Runtime.trap("Module access required: tickets"); };
    switch (tickets.get(id)) {
      case (?_) { ticketArchived.add(id, false); true };
      case null { false };
    };
  };

  public query ({ caller }) func listArchivedTicketIds() : async [Nat] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "tickets")) { Runtime.trap("Module access required: tickets"); };
    var result = List.empty<Nat>();
    for ((id, archived) in ticketArchived.entries()) {
      if (archived) { result.add(id); };
    };
    result.toArray();
  };

  public shared ({ caller }) func markTicketSeen(id : Nat) : async Bool {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "tickets")) { Runtime.trap("Module access required: tickets"); };
    switch (tickets.get(id)) {
      case (?t) { ticketSeenCounts.add(id, t.replies.size()); true };
      case null { false };
    };
  };

  public query ({ caller }) func getTicketSeenCounts() : async [(Nat, Nat)] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "tickets")) { Runtime.trap("Module access required: tickets"); };
    var result = List.empty<(Nat, Nat)>();
    for ((id, count) in ticketSeenCounts.entries()) {
      result.add((id, count));
    };
    result.toArray();
  };

};
