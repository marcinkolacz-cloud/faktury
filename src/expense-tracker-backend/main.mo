import Map "mo:core/Map";
import List "mo:core/List";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Time "mo:core/Time";
import Int "mo:core/Int";
import Blob "mo:core/Blob";
import ExperimentalCycles "mo:base/ExperimentalCycles";
import Json "mo:json";
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
import CalendarApi "mixins/CalendarApi";

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
  let calendarEvents = Map.empty<Nat, Types.CalendarEvent>();
  let calendarAttachments = Map.empty<Nat, [(Text, Text)]>();
  let calendarNotes = Map.empty<Nat, Types.CalendarNote>();
  let recentSubmissionTimes = List.empty<Int>();
  let recentClientReplyTimes = List.empty<Int>();
  let accessRoles = Map.empty<Principal, Types.Role>();
  let moduleAccess = Map.empty<Principal, [Text]>();
  var adminPrincipal : ?Principal = null;
  var oneDriveTokens : ?Types.OneDriveTokens = null;
  var pendingDeviceCode : ?Text = null;
  var pendingInterval : Nat = 5;

  let oneDriveClientId = "427bbeee-c6bd-4dfc-9946-9b230aec7861";

  type HttpHeader = { name : Text; value : Text };
  type HttpMethod = { #get; #post; #head };
  type TransformArgs = { context : Blob; response : HttpResponsePayload };
  type HttpResponsePayload = { status : Nat; headers : [HttpHeader]; body : Blob };
  type HttpRequestArgs = {
    url : Text;
    max_response_bytes : ?Nat64;
    headers : [HttpHeader];
    body : ?Blob;
    method : HttpMethod;
    transform : ?{ function : shared query (TransformArgs) -> async HttpResponsePayload; context : Blob };
  };
  type IC = actor {
    http_request : HttpRequestArgs -> async HttpResponsePayload;
  };
  let ic : IC = actor ("aaaaa-aa");

  include ProjectsApi(projects, accessRoles);
  include AdvancePaymentsApi(advancePayments, accessRoles);
  include ExpensesApi(expenses, accessRoles, expenseKsefSent);
  include WarehouseApi(warehouseItems, stockMovements, accessRoles);
  include TicketsApi(tickets, accessRoles, recentSubmissionTimes, ticketTokens, ticketExtras, ticketArchived, ticketSeenCounts, recentClientReplyTimes);
  include TicketAttachmentsApi(ticketAttachments, ticketAttachmentChunks, tickets, recentAttachmentTimes, accessRoles);
  include FilesApi(files, fileChunks, folders, accessRoles);
  include CalendarApi(calendarEvents, calendarAttachments, calendarNotes, accessRoles);

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
