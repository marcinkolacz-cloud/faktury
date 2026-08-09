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
import Float "mo:core/Float";
import Nat "mo:core/Nat";
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
import EmailSubscribersApi "mixins/EmailSubscribersApi";
import DevicesApi "mixins/DevicesApi";
import AiAgentConfigApi "mixins/AiAgentConfigApi";
import FlaggedActionsApi "mixins/FlaggedActionsApi";
import ProjectTemplatesApi "mixins/ProjectTemplatesApi";
import WelcomeSummaryApi "mixins/WelcomeSummaryApi";
import ProjectBuildsApi "mixins/ProjectBuildsApi";
import ChatArchiveApi "mixins/ChatArchiveApi";

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
  let ticketDriveAttachments = Map.empty<Nat, Types.TicketDriveAttachment>();
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
  let emailSubscribers = Map.empty<Nat, Types.Subscriber>();
  let devices = Map.empty<Nat, Types.Device>();
  let devicesTrashed = Map.empty<Nat, Int>();
  let deviceServiceEntries = Map.empty<Nat, Types.DeviceServiceEntry>();
  let deviceServiceEntriesV2 = Map.empty<Nat, Types.DeviceServiceEntryV2>();
  // Separate maps for OneDrive folder paths, added alongside the existing
  // (now unused/deprecated) driveFolderId : ?Nat fields on Ticket links /
  // Order / Contract. Never retype an existing stable field in place —
  // Motoko's upgrade check does not treat that as compatible and it traps
  // with "Memory-incompatible program upgrade". A brand new Map is always
  // upgrade-safe.
  let ticketDriveFolders = Map.empty<Nat, Text>();
  let orderDriveFolders = Map.empty<Nat, Text>();
  let orderProductionEstimates = Map.empty<Nat, Text>();
  let contractDriveFolders = Map.empty<Nat, Text>();
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
  let aiAgentConfig = Map.empty<Text, Types.AiAgentConfigEntry>();
  let aiConfigPasswords = Map.empty<Principal, Blob>();
  let aiConfigUnlocked = Map.empty<Principal, Bool>();
  let aiConfigAuditLog = List.empty<Types.AiConfigAuditEntry>();
  let aiConfigAttempts = Map.empty<Principal, (Nat, Int)>();
  let projectTemplates = Map.empty<Text, Types.ProjectTemplate>();
  let userLastSeen = Map.empty<Principal, Int>();
  let projectBuilds = Map.empty<Nat, Types.ProjectBuild>();
  let chatArchives = Map.empty<Nat, Types.ChatArchiveEntry>();

  // Punkt wyjścia do edycji w panelu Agenta AI — czasy w dniach są
  // orientacyjne, podmień na realne na podstawie BAS004 / TRA003 / BAS005.
  let defaultBasTasks : [Types.ProjectTemplateTask] = [
    { id = 1; title = "Projekt / aktualizacja BOM na bazie poprzedniego projektu"; category = "Projektowanie"; estimatedDays = 3 },
    { id = 2; title = "Zamówienie płyty głównej i komponentów kluczowych (z uwzględnieniem zamienników)"; category = "Zakupy"; estimatedDays = 14 },
    { id = 3; title = "Budowa konstrukcji / obudowy"; category = "Mechanika"; estimatedDays = 10 },
    { id = 4; title = "Montaż elektroniki i okablowania"; category = "Elektronika"; estimatedDays = 7 },
    { id = 5; title = "Instalacja i konfiguracja komputera głównego"; category = "Software"; estimatedDays = 3 },
    { id = 6; title = "Montaż ekranów i systemu wizualizacji"; category = "Wizualizacja"; estimatedDays = 5 },
    { id = 7; title = "Budowa i montaż kabiny instruktora"; category = "Mechanika"; estimatedDays = 7 },
    { id = 8; title = "Kalibracja i testy systemów"; category = "Testy"; estimatedDays = 5 },
    { id = 9; title = "Testy końcowe i odbiór"; category = "Testy"; estimatedDays = 3 },
    { id = 10; title = "Pakowanie i wysyłka"; category = "Logistyka"; estimatedDays = 2 },
  ];

  let defaultTraTasks : [Types.ProjectTemplateTask] = [
    { id = 1; title = "Projekt / aktualizacja BOM"; category = "Projektowanie"; estimatedDays = 2 },
    { id = 2; title = "Zamówienie komponentów"; category = "Zakupy"; estimatedDays = 10 },
    { id = 3; title = "Budowa konstrukcji"; category = "Mechanika"; estimatedDays = 5 },
    { id = 4; title = "Montaż elektroniki"; category = "Elektronika"; estimatedDays = 4 },
    { id = 5; title = "Instalacja i konfiguracja oprogramowania"; category = "Software"; estimatedDays = 2 },
    { id = 6; title = "Kalibracja i testy"; category = "Testy"; estimatedDays = 3 },
    { id = 7; title = "Pakowanie i wysyłka"; category = "Logistyka"; estimatedDays = 1 },
  ];

  let defaultBasLiteTasks : [Types.ProjectTemplateTask] = [
    { id = 1; title = "Projekt / aktualizacja BOM na bazie poprzedniego projektu"; category = "Projektowanie"; estimatedDays = 3 },
    { id = 2; title = "Zamówienie komponentów (bez ekranów i kabiny instruktora)"; category = "Zakupy"; estimatedDays = 12 },
    { id = 3; title = "Budowa konstrukcji / obudowy"; category = "Mechanika"; estimatedDays = 8 },
    { id = 4; title = "Montaż elektroniki i okablowania"; category = "Elektronika"; estimatedDays = 6 },
    { id = 5; title = "Instalacja i konfiguracja komputera głównego"; category = "Software"; estimatedDays = 3 },
    { id = 6; title = "Kalibracja i testy systemów"; category = "Testy"; estimatedDays = 4 },
    { id = 7; title = "Testy końcowe i odbiór"; category = "Testy"; estimatedDays = 2 },
    { id = 8; title = "Pakowanie i wysyłka"; category = "Logistyka"; estimatedDays = 2 },
  ];

  func seedProjectTemplateIfMissing(key : Text, title : Text, tasks : [Types.ProjectTemplateTask]) {
    switch (projectTemplates.get(key)) {
      case (?_) {};
      case null { projectTemplates.add(key, { key; title; tasks }); };
    };
  };
  seedProjectTemplateIfMissing("BAS", "Symulator BAS (pełny — kabina instruktora + ekrany), np. BAS004", defaultBasTasks);
  seedProjectTemplateIfMissing("TRA", "Trenażer TRA, np. TRA003", defaultTraTasks);
  seedProjectTemplateIfMissing("BAS_LITE", "Symulator BAS bez kabiny instruktora i ekranów, np. BAS005", defaultBasLiteTasks);

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
  include TicketAttachmentsApi(ticketAttachments, ticketAttachmentChunks, tickets, recentAttachmentTimes, accessRoles, ticketTokens, ticketAttachmentsTrashed, moduleAccess, ticketAttachmentUploader, ticketDriveAttachments);
  include FilesApi(files, fileChunks, folders, accessRoles, filesTrashed, foldersTrashed, moduleAccess);
  include CalendarApi(calendarEvents, calendarAttachments, calendarNotes, accessRoles, calendarEventsTrashed, calendarNotesTrashed, moduleAccess, calendarEventCreator);
  include TicketLinksApi(tickets, ticketLinks, ticketDriveFolders, calendarEvents, calendarEventCreator, accessRoles, moduleAccess);
  include OrdersApi(orders, ordersTrashed, orderDriveFolders, accessRoles, moduleAccess);
  include ContractsApi(contracts, contractsTrashed, contractDriveFolders, accessRoles, moduleAccess);
  include EmailSubscribersApi(emailSubscribers, accessRoles, moduleAccess);
  include DevicesApi(devices, devicesTrashed, deviceServiceEntriesV2, accessRoles, moduleAccess);
  include KsefApi(pendingInvoices, accessRoles, invoiceSharedToTeam, invoiceLineItems, invoiceOneDriveLink, moduleAccess);
  include AiAgentConfigApi(aiAgentConfig, aiConfigPasswords, aiConfigUnlocked, aiConfigAuditLog, aiConfigAttempts, accessRoles, moduleAccess);
  include FlaggedActionsApi(orders, ordersTrashed, orderDriveFolders, orderProductionEstimates, contracts, contractsTrashed, contractDriveFolders, expenses, expensesTrashed, pendingInvoices, accessRoles, moduleAccess);
  include ProjectTemplatesApi(projectTemplates, aiConfigUnlocked, accessRoles, moduleAccess);
  include WelcomeSummaryApi(orders, ordersTrashed, contracts, contractsTrashed, calendarEvents, calendarEventsTrashed, pendingInvoices, userLastSeen, accessRoles, moduleAccess);
  include ProjectBuildsApi(projectBuilds, accessRoles, moduleAccess);
  include ChatArchiveApi(chatArchives, accessRoles, moduleAccess);

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

  func mintDriveToken(owner : Principal) : async* Text {
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
    driveTokenOwner.add(token, owner);
    token;
  };

  public shared ({ caller }) func requestDriveAccessToken() : async Text {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    await* mintDriveToken(caller);
  };

  // Same short-lived (5 min) token mechanism as Drive — the onedrive-proxy
  // Worker's existing getDriveTokenRole(token) query is fully generic (just
  // "is this token valid, and what's its owner's role"), so the same Worker
  // reuses it here unchanged for the AI agent chat endpoint. Only difference:
  // this mint additionally requires the "agent" module checkbox.
  public shared ({ caller }) func requestAgentChatToken() : async Text {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "agent")) { Runtime.trap("Module access required: agent"); };
    await* mintDriveToken(caller);
  };

  // Assembles the system-prompt context for the agent chat: the free-text
  // instructions calibrated in the config panel, plus a snapshot of active
  // project builds (task list + planned dates + status) so the model can
  // reason about the real current state without needing separate tool
  // calls for every question.
  public query ({ caller }) func getAgentContext() : async Text {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "agent")) { Runtime.trap("Module access required: agent"); };
    var configText = "";
    for ((_, e) in aiAgentConfig.entries()) {
      let valueText = switch (e.value) {
        case (#bool(b)) { if (b) { "true" } else { "false" } };
        case (#text(t)) { t };
        case (#number(n)) { Float.toText(n) };
      };
      configText #= e.key # ": " # valueText # "\n";
    };
    var buildsText = "";
    for ((_, b) in projectBuilds.entries()) {
      buildsText #= "\nBuild " # b.projectCode # " (szablon " # b.templateKey # ", id=" # Nat.toText(b.id) # "):";
      for (t in b.tasks.vals()) {
        let st = switch (t.status) {
          case (#notStarted) { "nie rozpoczęto" };
          case (#inProgress) { "w trakcie" };
          case (#done) { "zrobione" };
        };
        buildsText #= "\n  - [id=" # Nat.toText(t.id) # "] " # t.title # " (" # t.category # ") status=" # st # " plan: " # t.plannedStart # " → " # t.plannedEnd;
      };
    };
    "KONFIGURACJA AGENTA (instrukcje ustawione przez admina):\n" # configText # "\nAKTYWNE BUDOWY PROJEKTÓW:" # buildsText;
  };

  // Narzędzie dla czatu agenta: koszty/faktury WYŁĄCZNIE przypisane do
  // projektów (moduł "Rejestr Faktur"). Celowo nie dotyka zamówień,
  // kontraktów, KSeF ani samego panelu admina/konfiguracji agenta —
  // to osobne, nieudostępnione tu dane. Wymaga modułów "agent" ORAZ
  // "invoices", nie wymaga roli admin.
  public query ({ caller }) func searchProjectExpenses(projectNameQuery : Text) : async [Types.ProjectExpenseSummary] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "agent")) { Runtime.trap("Module access required: agent"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "invoices")) { Runtime.trap("Module access required: invoices"); };
    var result = List.empty<Types.ProjectExpenseSummary>();
    var count = 0;
    label outer for ((pid, p) in projects.entries()) {
      if (projectsTrashed.get(pid) == null and (projectNameQuery == "" or Text.contains(p.name, #text projectNameQuery))) {
        for ((eid, e) in expenses.entries()) {
          if (count >= 200) { break outer; };
          if (e.projectId == pid and expensesTrashed.get(eid) == null) {
            result.add({
              projectId = pid;
              projectName = p.name;
              supplier = e.supplier;
              productService = e.productService;
              priceNet = e.priceNet;
              pricePln = e.pricePln;
              orderDate = e.orderDate;
              hasInvoice = e.hasInvoice;
              paid = e.paid;
            });
            count += 1;
          };
        };
      };
    };
    result.toArray();
  };

  // Lets an anonymous client who just submitted a support ticket upload
  // attachment photos straight to OneDrive (via the onedrive-proxy Worker),
  // without ever writing the file bytes into canister memory. Scoped
  // narrowly: only usable with the ticket's own tracking token, and the
  // resulting Drive token is the same short-lived (5 min), write-only
  // token staff get — just minted under the admin's role so the Worker's
  // role check passes for an otherwise role-less anonymous caller.
  public shared func requestTicketUploadDriveToken(ticketToken : Text) : async ?Text {
    switch (ticketTokens.get(ticketToken)) {
      case null { return null };
      case (?_) {};
    };
    switch (adminPrincipal) {
      case null { null };
      case (?admin) { ?(await* mintDriveToken(admin)) };
    };
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
