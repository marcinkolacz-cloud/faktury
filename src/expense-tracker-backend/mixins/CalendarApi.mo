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
  calendarEventsTrashed : Map.Map<Nat, Int>,
  calendarNotesTrashed : Map.Map<Nat, Int>,
  moduleAccess : Map.Map<Principal, [Text]>,
  calendarEventCreator : Map.Map<Nat, Principal>,
) {
  public shared ({ caller }) func createCalendarNote(eventId : Nat, title : Text, content : Text) : async Nat {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "calendar")) { Runtime.trap("Module access required: calendar"); };
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
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "calendar")) { Runtime.trap("Module access required: calendar"); };
    var result = List.empty<Types.CalendarNote>();
    for ((id, n) in calendarNotes.entries()) {
      if (n.eventId == eventId and calendarNotesTrashed.get(id) == null) { result.add(n); };
    };
    result.toArray();
  };

  public query ({ caller }) func listTrashedCalendarNotes() : async [Types.CalendarNote] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "calendar")) { Runtime.trap("Module access required: calendar"); };
    var result = List.empty<Types.CalendarNote>();
    for ((id, _) in calendarNotesTrashed.entries()) {
      switch (calendarNotes.get(id)) {
        case (?n) { result.add(n); };
        case null {};
      };
    };
    result.toArray();
  };

  public shared ({ caller }) func updateCalendarNote(id : Nat, title : Text, content : Text) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "calendar")) { Runtime.trap("Module access required: calendar"); };
    switch (calendarNotes.get(id)) {
      case (?n) { calendarNotes.add(id, { n with title; content }); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func trashCalendarNote(id : Nat) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "calendar")) { Runtime.trap("Module access required: calendar"); };
    switch (calendarNotes.get(id)) {
      case (?_) { calendarNotesTrashed.add(id, Time.now()); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func restoreCalendarNote(id : Nat) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "calendar")) { Runtime.trap("Module access required: calendar"); };
    switch (calendarNotesTrashed.get(id)) {
      case (?_) { calendarNotesTrashed.remove(id); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func permanentlyDeleteCalendarNote(id : Nat) : async Bool {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can permanently delete"); };
    calendarNotesTrashed.remove(id);
    switch (calendarNotes.get(id)) {
      case (?_) { calendarNotes.remove(id); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func addCalendarAttachment(eventId : Nat, oneDriveItemId : Text, name : Text) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "calendar")) { Runtime.trap("Module access required: calendar"); };
    let current = switch (calendarAttachments.get(eventId)) { case (?a) { a }; case null { [] } };
    calendarAttachments.add(eventId, Array.concat(current, [(oneDriveItemId, name)]));
    true;
  };

  public query ({ caller }) func listCalendarAttachments(eventId : Nat) : async [(Text, Text)] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "calendar")) { Runtime.trap("Module access required: calendar"); };
    switch (calendarAttachments.get(eventId)) { case (?a) { a }; case null { [] } };
  };

  public shared ({ caller }) func removeCalendarAttachment(eventId : Nat, oneDriveItemId : Text) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "calendar")) { Runtime.trap("Module access required: calendar"); };
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
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "calendar")) { Runtime.trap("Module access required: calendar"); };
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
    newId;
  };

  public query ({ caller }) func listCalendarEvents() : async [Types.CalendarEvent] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "calendar")) { Runtime.trap("Module access required: calendar"); };
    var result = List.empty<Types.CalendarEvent>();
    for ((id, e) in calendarEvents.entries()) {
      if (calendarEventsTrashed.get(id) == null) { result.add(e); };
    };
    result.toArray();
  };

  public query ({ caller }) func listCalendarEventCreators() : async [(Nat, Principal)] {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can view this"); };
    var result = List.empty<(Nat, Principal)>();
    for ((id, p) in calendarEventCreator.entries()) { result.add((id, p)); };
    result.toArray();
  };

  public shared ({ caller }) func toggleCalendarEventDone(id : Nat) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "calendar")) { Runtime.trap("Module access required: calendar"); };
    switch (calendarEvents.get(id)) {
      case (?e) { calendarEvents.add(id, { e with done = not e.done }); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func trashCalendarEvent(id : Nat) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "calendar")) { Runtime.trap("Module access required: calendar"); };
    switch (calendarEvents.get(id)) {
      case (?_) { calendarEventsTrashed.add(id, Time.now()); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func restoreCalendarEvent(id : Nat) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "calendar")) { Runtime.trap("Module access required: calendar"); };
    switch (calendarEventsTrashed.get(id)) {
      case (?_) { calendarEventsTrashed.remove(id); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func permanentlyDeleteCalendarEvent(id : Nat) : async Bool {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can permanently delete"); };
    calendarEventsTrashed.remove(id);
    switch (calendarEvents.get(id)) {
      case (?_) { calendarEvents.remove(id); true; };
      case null { false };
    };
  };

  public query ({ caller }) func listTrashedCalendarEvents() : async [Types.CalendarEvent] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "calendar")) { Runtime.trap("Module access required: calendar"); };
    var result = List.empty<Types.CalendarEvent>();
    for ((id, _) in calendarEventsTrashed.entries()) {
      switch (calendarEvents.get(id)) {
        case (?e) { result.add(e); };
        case null {};
      };
    };
    result.toArray();
  };

  public shared ({ caller }) func importCalendarEvents(rows : [Types.CalendarEvent], overwrite : Bool) : async Nat {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can import data"); };
    var count = 0;
    for (e in rows.vals()) {
      switch (calendarEvents.get(e.id)) {
        case (?_) { if (overwrite) { calendarEvents.add(e.id, e); count += 1; }; };
        case null { calendarEvents.add(e.id, e); count += 1; };
      };
    };
    count;
  };

  public shared ({ caller }) func importCalendarNotes(rows : [Types.CalendarNote], overwrite : Bool) : async Nat {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can import data"); };
    var count = 0;
    for (n in rows.vals()) {
      switch (calendarNotes.get(n.id)) {
        case (?_) { if (overwrite) { calendarNotes.add(n.id, n); count += 1; }; };
        case null { calendarNotes.add(n.id, n); count += 1; };
      };
    };
    count;
  };

  public shared ({ caller }) func importCalendarAttachments(rows : [(Nat, [(Text, Text)])], overwrite : Bool) : async Nat {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can import data"); };
    var count = 0;
    for ((eventId, atts) in rows.vals()) {
      switch (calendarAttachments.get(eventId)) {
        case (?_) { if (overwrite) { calendarAttachments.add(eventId, atts); count += 1; }; };
        case null { calendarAttachments.add(eventId, atts); count += 1; };
      };
    };
    count;
  };

  public query ({ caller }) func listTrashedCalendarEventEntries() : async [(Nat, Int)] {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can view this"); };
    var result = List.empty<(Nat, Int)>();
    for ((id, ts) in calendarEventsTrashed.entries()) { result.add((id, ts)); };
    result.toArray();
  };

  public query ({ caller }) func listTrashedCalendarNoteEntries() : async [(Nat, Int)] {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can view this"); };
    var result = List.empty<(Nat, Int)>();
    for ((id, ts) in calendarNotesTrashed.entries()) { result.add((id, ts)); };
    result.toArray();
  };

  public shared ({ caller }) func importTrashedCalendarEvents(entries : [(Nat, Int)], overwrite : Bool) : async Nat {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can import data"); };
    var count = 0;
    for ((id, ts) in entries.vals()) {
      switch (calendarEventsTrashed.get(id)) {
        case (?_) { if (overwrite) { calendarEventsTrashed.add(id, ts); count += 1; }; };
        case null { calendarEventsTrashed.add(id, ts); count += 1; };
      };
    };
    count;
  };

  public shared ({ caller }) func importTrashedCalendarNotes(entries : [(Nat, Int)], overwrite : Bool) : async Nat {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can import data"); };
    var count = 0;
    for ((id, ts) in entries.vals()) {
      switch (calendarNotesTrashed.get(id)) {
        case (?_) { if (overwrite) { calendarNotesTrashed.add(id, ts); count += 1; }; };
        case null { calendarNotesTrashed.add(id, ts); count += 1; };
      };
    };
    count;
  };
}
