import Map "mo:core/Map";
import List "mo:core/List";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Types "types";
import AccessLib "lib/access";
import InvitesLib "lib/invites";
import ProjectsApi "mixins/ProjectsApi";
import AdvancePaymentsApi "mixins/AdvancePaymentsApi";
import ExpensesApi "mixins/ExpensesApi";
import InvitesApi "mixins/InvitesApi";
import WarehouseApi "mixins/WarehouseApi";
import TicketsApi "mixins/TicketsApi";
import TicketAttachmentsApi "mixins/TicketAttachmentsApi";
import FilesApi "mixins/FilesApi";

persistent actor {
  let projects = Map.empty<Nat, Types.Project>();
  let advancePayments = Map.empty<Nat, Types.AdvancePayment>();
  let expenses = Map.empty<Nat, Types.Expense>();
  let expenseKsefSent = Map.empty<Nat, Bool>();
  let inviteCodes = Map.empty<Text, InvitesLib.InviteCode>();
  let warehouseItems = Map.empty<Nat, Types.WarehouseItem>();
  let stockMovements = Map.empty<Nat, Types.StockMovement>();
  let tickets = Map.empty<Nat, Types.Ticket>();
  let ticketTokens = Map.empty<Text, Nat>();
  let ticketExtras = Map.empty<Nat, Types.TicketExtras>();
  let ticketArchived = Map.empty<Nat, Bool>();
  let ticketAttachments = Map.empty<Nat, Types.TicketAttachmentMeta>();
  let ticketAttachmentChunks = Map.empty<Text, Blob>();
  let recentAttachmentTimes = List.empty<Int>();
  let ticketSeenCounts = Map.empty<Nat, Nat>();
  let files = Map.empty<Nat, Types.FileMeta>();
  let fileChunks = Map.empty<Text, Blob>();
  let folders = Map.empty<Nat, Types.Folder>();
  let recentSubmissionTimes = List.empty<Int>();
  let recentClientReplyTimes = List.empty<Int>();
  let accessRoles = Map.empty<Principal, Types.Role>();
  let moduleAccess = Map.empty<Principal, [Text]>();
  var adminPrincipal : ?Principal = null;

  include ProjectsApi(projects, accessRoles);
  include AdvancePaymentsApi(advancePayments, accessRoles);
  include ExpensesApi(expenses, accessRoles, expenseKsefSent);
  include WarehouseApi(warehouseItems, stockMovements, accessRoles);
  include TicketsApi(tickets, accessRoles, recentSubmissionTimes, ticketTokens, ticketExtras, ticketArchived, ticketSeenCounts, recentClientReplyTimes);
  include TicketAttachmentsApi(ticketAttachments, ticketAttachmentChunks, tickets, recentAttachmentTimes, accessRoles);
  include FilesApi(files, fileChunks, folders, accessRoles);

  func isAdmin(caller : Principal) : Bool {
    let bootstrapMatch = switch (adminPrincipal) { case (?admin) { Principal.equal(admin, caller) }; case null { false } };
    bootstrapMatch or AccessLib.isAdmin(accessRoles, caller);
  };

  include InvitesApi(inviteCodes, accessRoles, moduleAccess, isAdmin);

  public shared ({ caller }) func setAdminPrincipal() : async () {
    switch (adminPrincipal) {
      case (?_) { Runtime.trap("Admin already set"); };
      case null {
        adminPrincipal := ?caller;
        accessRoles.add(caller, #admin);
      };
    };
  };

  public query ({ caller }) func isCallerAdmin() : async Bool {
    isAdmin(caller);
  };
};
