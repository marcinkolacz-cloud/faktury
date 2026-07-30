import Map "mo:core/Map";
import List "mo:core/List";
import Types "../types";
import Principal "mo:core/Principal";
import Time "mo:core/Time";
import Runtime "mo:core/Runtime";
import Nat "mo:core/Nat";
import AccessLib "../lib/access";
import Array "mo:core/Array";

mixin (
  calendarEvents : Map.Map<Nat, Types.CalendarEvent>,
  calendarAttachments : Map.Map<Nat, [(Text, Text)]>,
  calendarNotes : Map.Map<Nat, Types.CalendarNote>,
  accessRoles : Map.Map<Principal, Types.Role>,
) {
  public shared ({ caller }) func createCalendarNote(eventId : Nat, title : Text, content : Text) : async Nat {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    var maxId = 0;
    var any = false;
    for ((id, _) in calendarNotes.entries()) {
      if (not any or id >= maxId) { maxId := id; any := true; };
    };
    let newId = if (any) { maxId + 1 } else { 0 };
    let note : Types.CalendarNote = { id = newId; eventId; title; content; createdAt = Time.now() };
    calendarNotes.add(newId, note);
    newId;
  };

  public query ({ caller }) func listCalendarNotes(eventId : Nat) : async [Types.CalendarNote] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    var result = List.empty<Types.CalendarNote>();
    for ((_, n) in calendarNotes.entries()) {
      if (n.eventId == eventId) { result.add(n); };
    };
    result.toArray();
  };

  public shared ({ caller }) func updateCalendarNote(id : Nat, title : Text, content : Text) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    switch (calendarNotes.get(id)) {
      case (?n) { calendarNotes.add(id, { n with title; content }); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func deleteCalendarNote(id : Nat) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    switch (calendarNotes.get(id)) {
      case (?_) { calendarNotes.remove(id); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func addCalendarAttachment(eventId : Nat, oneDriveItemId : Text, name : Text) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    let current = switch (calendarAttachments.get(eventId)) { case (?a) { a }; case null { [] } };
    calendarAttachments.add(eventId, Array.concat(current, [(oneDriveItemId, name)]));
    true;
  };

  public query ({ caller }) func listCalendarAttachments(eventId : Nat) : async [(Text, Text)] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    switch (calendarAttachments.get(eventId)) { case (?a) { a }; case null { [] } };
  };

  public shared ({ caller }) func removeCalendarAttachment(eventId : Nat, oneDriveItemId : Text) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    let current = switch (calendarAttachments.get(eventId)) { case (?a) { a }; case null { [] } };
    calendarAttachments.add(eventId, Array.filter<(Text, Text)>(current, func((id, _)) { id != oneDriveItemId }));
    true;
  };
  public shared ({ caller }) func createCalendarEvent(
    title : Text,
    description : Text,
    startDate : Text,
    endDate : Text,
    eventType : Types.CalendarEventType,
    createdBy : Text,
  ) : async Nat {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
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
    newId;
  };

  public query ({ caller }) func listCalendarEvents() : async [Types.CalendarEvent] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    var result = List.empty<Types.CalendarEvent>();
    for ((_, e) in calendarEvents.entries()) {
      result.add(e);
    };
    result.toArray();
  };

  public shared ({ caller }) func toggleCalendarEventDone(id : Nat) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    switch (calendarEvents.get(id)) {
      case (?e) { calendarEvents.add(id, { e with done = not e.done }); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func deleteCalendarEvent(id : Nat) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    switch (calendarEvents.get(id)) {
      case (?_) { calendarEvents.remove(id); true; };
      case null { false };
    };
  };
}
