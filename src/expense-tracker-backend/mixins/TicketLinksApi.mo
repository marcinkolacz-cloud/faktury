import Map "mo:core/Map";
import List "mo:core/List";
import Types "../types";
import Principal "mo:core/Principal";
import Time "mo:core/Time";
import Runtime "mo:core/Runtime";
import Nat "mo:core/Nat";
import AccessLib "../lib/access";

mixin (
  tickets : Map.Map<Nat, Types.Ticket>,
  ticketLinks : Map.Map<Nat, Types.TicketLinks>,
  calendarEvents : Map.Map<Nat, Types.CalendarEvent>,
  calendarEventCreator : Map.Map<Nat, Principal>,
  folders : Map.Map<Nat, Types.Folder>,
  accessRoles : Map.Map<Principal, Types.Role>,
  moduleAccess : Map.Map<Principal, [Text]>,
) {
  func emptyLinks() : Types.TicketLinks { { calendarEventId = null; driveFolderId = null } };

  func getLinks(ticketId : Nat) : Types.TicketLinks {
    switch (ticketLinks.get(ticketId)) {
      case (?l) { l };
      case null { emptyLinks() };
    };
  };

  func requireTicketAccess(caller : Principal) {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "tickets")) { Runtime.trap("Module access required: tickets"); };
  };

  public query ({ caller }) func getTicketLinks(ticketId : Nat) : async Types.TicketLinks {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "tickets")) { Runtime.trap("Module access required: tickets"); };
    getLinks(ticketId);
  };

  public query ({ caller }) func listTicketLinks() : async [(Nat, Types.TicketLinks)] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "tickets")) { Runtime.trap("Module access required: tickets"); };
    var result = List.empty<(Nat, Types.TicketLinks)>();
    for ((id, l) in ticketLinks.entries()) { result.add((id, l)); };
    result.toArray();
  };

  public shared ({ caller }) func createCalendarEventForTicket(
    ticketId : Nat,
    title : Text,
    description : Text,
    startDate : Text,
    endDate : Text,
    eventType : Types.CalendarEventType,
    createdBy : Text,
  ) : async ?Nat {
    requireTicketAccess(caller);
    switch (tickets.get(ticketId)) {
      case null { null };
      case (?_) {
        var maxId = 0;
        var any = false;
        for ((id, _) in calendarEvents.entries()) {
          if (not any or id >= maxId) { maxId := id; any := true; };
        };
        let newId = if (any) { maxId + 1 } else { 0 };
        let event : Types.CalendarEvent = {
          id = newId;
          title;
          description;
          startDate;
          endDate;
          eventType;
          createdBy;
          createdAt = Time.now();
          done = false;
        };
        calendarEvents.add(newId, event);
        calendarEventCreator.add(newId, caller);
        let current = getLinks(ticketId);
        ticketLinks.add(ticketId, { current with calendarEventId = ?newId });
        ?newId;
      };
    };
  };

  public shared ({ caller }) func createDriveFolderForTicket(ticketId : Nat, folderName : Text, parentId : ?Nat) : async ?Nat {
    requireTicketAccess(caller);
    switch (tickets.get(ticketId)) {
      case null { null };
      case (?_) {
        var maxId = 0;
        var any = false;
        for ((id, _) in folders.entries()) {
          if (not any or id >= maxId) { maxId := id; any := true; };
        };
        let newId = if (any) { maxId + 1 } else { 0 };
        let folder : Types.Folder = {
          id = newId;
          name = folderName;
          parentId;
          createdBy = caller.toText();
          createdAt = Time.now();
        };
        folders.add(newId, folder);
        let current = getLinks(ticketId);
        ticketLinks.add(ticketId, { current with driveFolderId = ?newId });
        ?newId;
      };
    };
  };

  public shared ({ caller }) func linkTicketCalendarEvent(ticketId : Nat, eventId : Nat) : async Bool {
    requireTicketAccess(caller);
    if (tickets.get(ticketId) == null or calendarEvents.get(eventId) == null) { return false; };
    let current = getLinks(ticketId);
    ticketLinks.add(ticketId, { current with calendarEventId = ?eventId });
    true;
  };

  public shared ({ caller }) func linkTicketDriveFolder(ticketId : Nat, folderId : Nat) : async Bool {
    requireTicketAccess(caller);
    if (tickets.get(ticketId) == null or folders.get(folderId) == null) { return false; };
    let current = getLinks(ticketId);
    ticketLinks.add(ticketId, { current with driveFolderId = ?folderId });
    true;
  };

  public shared ({ caller }) func unlinkTicketCalendarEvent(ticketId : Nat) : async Bool {
    requireTicketAccess(caller);
    let current = getLinks(ticketId);
    ticketLinks.add(ticketId, { current with calendarEventId = null });
    true;
  };

  public shared ({ caller }) func unlinkTicketDriveFolder(ticketId : Nat) : async Bool {
    requireTicketAccess(caller);
    let current = getLinks(ticketId);
    ticketLinks.add(ticketId, { current with driveFolderId = null });
    true;
  };

  public shared ({ caller }) func importTicketLinks(rows : [(Nat, Types.TicketLinks)]) : async Nat {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can import data"); };
    var count = 0;
    for ((id, links) in rows.vals()) {
      switch (ticketLinks.get(id)) {
        case (?_) {};
        case null { ticketLinks.add(id, links); count += 1; };
      };
    };
    count;
  };
};
