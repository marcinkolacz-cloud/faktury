import Map "mo:core/Map";
import List "mo:core/List";
import Types "../types";
import Principal "mo:core/Principal";
import Time "mo:core/Time";
import Runtime "mo:core/Runtime";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import AccessLib "../lib/access";

mixin (
  ticketAttachments : Map.Map<Nat, Types.TicketAttachmentMeta>,
  ticketAttachmentChunks : Map.Map<Text, Blob>,
  tickets : Map.Map<Nat, Types.Ticket>,
  recentAttachmentTimes : List.List<Int>,
  accessRoles : Map.Map<Principal, Types.Role>,
  ticketTokens : Map.Map<Text, Nat>,
  ticketAttachmentsTrashed : Map.Map<Nat, Int>,
) {
  func callerAuthorizedForTicket(caller : Principal, ticketId : Nat, token : ?Text) : Bool {
    if (AccessLib.hasAnyRole(accessRoles, caller)) { return true; };
    switch (token) {
      case (?t) {
        switch (ticketTokens.get(t)) {
          case (?id) { id == ticketId };
          case null { false };
        };
      };
      case null { false };
    };
  };
  let maxAttachmentSize = 5_000_000;

  public shared ({ caller }) func createTicketAttachment(
    ticketId : Nat,
    name : Text,
    contentType : Text,
    size : Nat,
    totalChunks : Nat,
    uploadedBy : Text,
    honeypot : Text,
    token : ?Text,
  ) : async Nat {
    if (honeypot != "") { Runtime.trap("Rejected"); };
    if (size > maxAttachmentSize) { Runtime.trap("File too large, max 5MB"); };
    if (not callerAuthorizedForTicket(caller, ticketId, token)) { Runtime.trap("Not authorized for this ticket"); };
    switch (tickets.get(ticketId)) {
      case null { Runtime.trap("Ticket not found"); };
      case (?_) {};
    };
    let now = Time.now();
    let oneMinuteAgo : Int = now - 60_000_000_000;
    var stillValid = List.empty<Int>();
    for (t in recentAttachmentTimes.values()) {
      if (t > oneMinuteAgo) { stillValid.add(t); };
    };
    if (stillValid.size() >= 10) { Runtime.trap("Rate limit exceeded, try again later"); };
    stillValid.add(now);
    recentAttachmentTimes.clear();
    for (t in stillValid.values()) { recentAttachmentTimes.add(t); };
    var maxId = 0;
    var any = false;
    for ((id, _) in ticketAttachments.entries()) {
      if (not any or id >= maxId) { maxId := id; any := true; };
    };
    let newId = if (any) { maxId + 1 } else { 0 };
    let meta : Types.TicketAttachmentMeta = {
      id = newId;
      ticketId;
      name;
      contentType;
      size;
      totalChunks;
      uploadedBy;
      createdAt = now;
    };
    ticketAttachments.add(newId, meta);
    newId;
  };

  public shared ({ caller }) func uploadTicketAttachmentChunk(attachmentId : Nat, chunkIndex : Nat, data : Blob, token : ?Text) : async Bool {
    switch (ticketAttachments.get(attachmentId)) {
      case (?meta) {
        if (not callerAuthorizedForTicket(caller, meta.ticketId, token)) { Runtime.trap("Not authorized for this ticket"); };
        let key = Nat.toText(attachmentId) # "-" # Nat.toText(chunkIndex);
        ticketAttachmentChunks.add(key, data);
        true;
      };
      case null { false };
    };
  };

  public shared ({ caller }) func importTicketAttachments(rows : [Types.TicketAttachmentMeta]) : async Nat {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can import data"); };
    var count = 0;
    for (a in rows.vals()) {
      ticketAttachments.add(a.id, a);
      count += 1;
    };
    count;
  };

  public query ({ caller }) func listTicketAttachments(ticketId : Nat, token : ?Text) : async [Types.TicketAttachmentMeta] {
    if (not callerAuthorizedForTicket(caller, ticketId, token)) { Runtime.trap("Not authorized for this ticket"); };
    var result = List.empty<Types.TicketAttachmentMeta>();
    for ((id, a) in ticketAttachments.entries()) {
      if (a.ticketId == ticketId and ticketAttachmentsTrashed.get(id) == null) { result.add(a); };
    };
    result.toArray();
  };

  public query ({ caller }) func getTicketAttachmentChunk(attachmentId : Nat, chunkIndex : Nat, token : ?Text) : async ?Blob {
    switch (ticketAttachments.get(attachmentId)) {
      case (?meta) {
        if (not callerAuthorizedForTicket(caller, meta.ticketId, token)) { Runtime.trap("Not authorized for this ticket"); };
      };
      case null { Runtime.trap("Attachment not found"); };
    };
    let key = Nat.toText(attachmentId) # "-" # Nat.toText(chunkIndex);
    ticketAttachmentChunks.get(key);
  };

  public shared ({ caller }) func trashTicketAttachment(attachmentId : Nat) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    switch (ticketAttachments.get(attachmentId)) {
      case (?_) { ticketAttachmentsTrashed.add(attachmentId, Time.now()); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func restoreTicketAttachment(attachmentId : Nat) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    switch (ticketAttachmentsTrashed.get(attachmentId)) {
      case (?_) { ticketAttachmentsTrashed.remove(attachmentId); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func permanentlyDeleteTicketAttachment(attachmentId : Nat) : async Bool {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can permanently delete"); };
    ticketAttachmentsTrashed.remove(attachmentId);
    switch (ticketAttachments.get(attachmentId)) {
      case (?meta) {
        var i = 0;
        while (i < meta.totalChunks) {
          let key = Nat.toText(attachmentId) # "-" # Nat.toText(i);
          ticketAttachmentChunks.remove(key);
          i += 1;
        };
        ticketAttachments.remove(attachmentId);
        true;
      };
      case null { false };
    };
  };

  public query ({ caller }) func listTrashedTicketAttachments() : async [Types.TicketAttachmentMeta] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    var result = List.empty<Types.TicketAttachmentMeta>();
    for ((id, _) in ticketAttachmentsTrashed.entries()) {
      switch (ticketAttachments.get(id)) {
        case (?a) { result.add(a); };
        case null {};
      };
    };
    result.toArray();
  };
};
