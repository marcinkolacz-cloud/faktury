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
import Random "mo:core/Random";
import Char "mo:core/Char";
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
import TicketLinksApi "mixins/TicketLinksApi";
import OrdersApi "mixins/OrdersApi";
import ContractsApi "mixins/ContractsApi";
import KsefApi "mixins/KsefApi";

persistent actor {
  let projects = Map.empty<Nat, Types.Project>();
  let advancePayments = Map.empty<Nat, Types.AdvancePayment>();
  let expenses = Map.empty<Nat, Types.Expense>();
  let expenseKsefSent = Map.empty<Nat, Bool>();
  let expensesTrashed = Map.empty<Nat, Int>();
  let advancePaymentsTrashed = Map.empty<Nat, Int>();
  let ticketAttachmentsTrashed = Map.empty<Nat, Int>();
  let warehouseItemsTrashed = Map.empty<Nat, Int>();
  let stockMovementsTrashed = Map.empty<Nat, Int>();
  let calendarEventsTrashed = Map.empty<Nat, Int>();
  let calendarNotesTrashed = Map.empty<Nat, Int>();
  let projectsTrashed = Map.empty<Nat, Int>();
  let filesTrashed = Map.empty<Nat, Int>();
  let foldersTrashed = Map.empty<Nat, Int>();
  let stockMovementPerformer = Map.empty<Nat, Principal>();
  let calendarEventCreator = Map.empty<Nat, Principal>();
  let ticketAttachmentUploader = Map.empty<Nat, Principal>();
  let pendingInvoices = Map.empty<Text, Types.PendingInvoice>();
  let invoiceSharedToTeam = Map.empty<Text, Bool>();
  let invoiceLineItems = Map.empty<Text, [Types.InvoiceLineItem]>();
  let invoiceOneDriveLink = Map.empty<Text, Text>();
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
  let ticketLinks = Map.empty<Nat, Types.TicketLinks>();
  let orders = Map.empty<Nat, Types.Order>();
  let ordersTrashed = Map.empty<Nat, Int>();
  let contracts = Map.empty<Nat, Types.Contract>();
  let contractsTrashed = Map.empty<Nat, Int>();
  let recentSubmissionTimes = List.empty<Int>();
  let recentClientReplyTimes = List.empty<Int>();
  let accessRoles = Map.empty<Principal, Types.Role>();
  let moduleAccess = Map.empty<Principal, [Text]>();
  var adminPrincipal : ?Principal = null;
  var oneDriveTokens : ?Types.OneDriveTokens = null;
  var pendingDeviceCode : ?Text = null;
  var pendingInterval : Nat = 5;
  let driveTokens = Map.empty<Text, Int>();
  let driveTokenOwner = Map.empty<Text, Principal>();
  let adminTokens = Map.empty<Text, Int>();
  let ksefReadTokens = Map.empty<Text, Int>();
  // Guards the previously wide-open ticket-email-worker and
  // bartolini-translate Workers, which had zero authentication and were
  // callable by anyone on the internet (open mail relay / free OpenAI
  // proxy risk). Any logged-in staff member (any role) can request one.
  let staffActionTokens = Map.empty<Text, Int>();
  let principalDisplayNames = Map.empty<Principal, Text>();

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

  include ProjectsApi(projects, accessRoles, projectsTrashed, moduleAccess);
  include AdvancePaymentsApi(advancePayments, accessRoles, advancePaymentsTrashed, moduleAccess);
  include ExpensesApi(expenses, accessRoles, expenseKsefSent, expensesTrashed, moduleAccess);
  include WarehouseApi(warehouseItems, stockMovements, accessRoles, warehouseItemsTrashed, stockMovementsTrashed, moduleAccess, stockMovementPerformer);
  include TicketsApi(tickets, accessRoles, recentSubmissionTimes, ticketTokens, ticketExtras, ticketArchived, ticketSeenCounts, recentClientReplyTimes, moduleAccess);
  include TicketAttachmentsApi(ticketAttachments, ticketAttachmentChunks, tickets, recentAttachmentTimes, accessRoles, ticketTokens, ticketAttachmentsTrashed, moduleAccess, ticketAttachmentUploader);
  include FilesApi(files, fileChunks, folders, accessRoles, filesTrashed, foldersTrashed, moduleAccess);
  include CalendarApi(calendarEvents, calendarAttachments, calendarNotes, accessRoles, calendarEventsTrashed, calendarNotesTrashed, moduleAccess, calendarEventCreator);
  include TicketLinksApi(tickets, ticketLinks, calendarEvents, calendarEventCreator, folders, accessRoles, moduleAccess);
  include OrdersApi(orders, ordersTrashed, folders, accessRoles, moduleAccess);
  include ContractsApi(contracts, contractsTrashed, folders, accessRoles, moduleAccess);
  include KsefApi(pendingInvoices, accessRoles, invoiceSharedToTeam, invoiceLineItems, invoiceOneDriveLink, moduleAccess);

  func isAdmin(caller : Principal) : Bool {
    let bootstrapMatch = switch (adminPrincipal) { case (?admin) { Principal.equal(admin, caller) }; case null { false } };
    bootstrapMatch or AccessLib.isAdmin(accessRoles, caller);
  };

  include InvitesApi(inviteCodes, accessRoles, moduleAccess, isAdmin);

  let driveTokenChars = [
    'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
    'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  ];

  public shared ({ caller }) func requestDriveAccessToken() : async Text {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    let now = Time.now();
    var expired = List.empty<Text>();
    for ((t, exp) in driveTokens.entries()) {
      if (exp < now) { expired.add(t); };
    };
    for (t in expired.values()) { driveTokens.remove(t); driveTokenOwner.remove(t); };
    let rng = Random.crypto();
    var token = "";
    var i = 0;
    while (i < 32) {
      let idx = await* rng.natRange(0, 36);
      token := token # driveTokenChars[idx].toText();
      i += 1;
    };
    driveTokens.add(token, now + 300_000_000_000);
    driveTokenOwner.add(token, caller);
    token;
  };

  public query func validateDriveToken(token : Text) : async Bool {
    switch (driveTokens.get(token)) {
      case (?exp) { Time.now() < exp };
      case null { false };
    };
  };

  // Added for onedrive-proxy Worker: the Worker previously only had a
  // Bool ("is this token valid at all"), so it could not tell a `read`
  // user apart from `write`/`admin` and let everyone hit destructive
  // endpoints (/delete, /share, /move, /rename, /uploadSession). This
  // returns the actual role of the token's owner so the Worker can
  // gate those endpoints properly.
  public query func getDriveTokenRole(token : Text) : async ?Types.Role {
    switch (driveTokens.get(token)) {
      case (?exp) {
        if (Time.now() >= exp) { return null };
        switch (driveTokenOwner.get(token)) {
          case (?owner) { accessRoles.get(owner) };
          case null { null };
        };
      };
      case null { null };
    };
  };

  public shared ({ caller }) func requestAdminAccessToken() : async Text {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Admin access required"); };
    let now = Time.now();
    var expired = List.empty<Text>();
    for ((t, exp) in adminTokens.entries()) {
      if (exp < now) { expired.add(t); };
    };
    for (t in expired.values()) { adminTokens.remove(t); };
    let rng = Random.crypto();
    var token = "";
    var i = 0;
    while (i < 32) {
      let idx = await* rng.natRange(0, 36);
      token := token # driveTokenChars[idx].toText();
      i += 1;
    };
    adminTokens.add(token, now + 300_000_000_000);
    token;
  };

  public query func validateAdminToken(token : Text) : async Bool {
    switch (adminTokens.get(token)) {
      case (?exp) { Time.now() < exp };
      case null { false };
    };
  };

  public shared ({ caller }) func requestKsefReadToken() : async Text {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    let now = Time.now();
    var expired = List.empty<Text>();
    for ((t, exp) in ksefReadTokens.entries()) {
      if (exp < now) { expired.add(t); };
    };
    for (t in expired.values()) { ksefReadTokens.remove(t); };
    let rng = Random.crypto();
    var token = "";
    var i = 0;
    while (i < 32) {
      let idx = await* rng.natRange(0, 36);
      token := token # driveTokenChars[idx].toText();
      i += 1;
    };
    ksefReadTokens.add(token, now + 300_000_000_000);
    token;
  };

  public query func validateKsefReadToken(token : Text) : async Bool {
    switch (ksefReadTokens.get(token)) {
      case (?exp) { Time.now() < exp };
      case null { false };
    };
  };

  public shared ({ caller }) func requestStaffActionToken() : async Text {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    let now = Time.now();
    var expired = List.empty<Text>();
    for ((t, exp) in staffActionTokens.entries()) {
      if (exp < now) { expired.add(t); };
    };
    for (t in expired.values()) { staffActionTokens.remove(t); };
    let rng = Random.crypto();
    var token = "";
    var i = 0;
    while (i < 32) {
      let idx = await* rng.natRange(0, 36);
      token := token # driveTokenChars[idx].toText();
      i += 1;
    };
    staffActionTokens.add(token, now + 300_000_000_000);
    token;
  };

  public query func validateStaffActionToken(token : Text) : async Bool {
    switch (staffActionTokens.get(token)) {
      case (?exp) { Time.now() < exp };
      case null { false };
    };
  };

  public shared ({ caller }) func setPrincipalDisplayName(target : Principal, name : Text) : async Bool {
    if (not isAdmin(caller)) { Runtime.trap("Only admin can set display names"); };
    if (Text.size(name) == 0) {
      principalDisplayNames.remove(target);
    } else {
      principalDisplayNames.add(target, name);
    };
    true;
  };

  public shared ({ caller }) func importPrincipalDisplayNames(entries : [(Principal, Text)]) : async Nat {
    if (not isAdmin(caller)) { Runtime.trap("Only admin can import data"); };
    var count = 0;
    for ((p, name) in entries.vals()) {
      switch (principalDisplayNames.get(p)) {
        case (?_) {};
        case null { principalDisplayNames.add(p, name); count += 1; };
      };
    };
    count;
  };

  public query ({ caller }) func listPrincipalDisplayNames() : async [(Principal, Text)] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    var result = List.empty<(Principal, Text)>();
    for ((p, name) in principalDisplayNames.entries()) {
      result.add((p, name));
    };
    result.toArray();
  };

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
