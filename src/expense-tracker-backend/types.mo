import Principal "mo:core/Principal";

module {
  public type Role = {
    #read;
    #write;
    #admin;
  };

  public type AccessEntry = {
    principal : Principal;
    role : Role;
    addedAt : Int;
  };

  public type AdvancePayment = {
    id : Nat;
    date : Text;
    amount : Float;
    currency : Text;
    note : Text;
    createdAt : Int;
  };

  public type Project = {
    id : Nat;
    name : Text;
    createdAt : Int;
  };

  public type TicketStatus = {
    #open_;
    #inProgress;
    #waitingForClient;
    #closed;
  };

  public type TicketReply = {
    author : Text;
    message : Text;
    isInternal : Bool;
    createdAt : Int;
  };

  public type Ticket = {
    id : Nat;
    clientName : Text;
    clientEmail : Text;
    subject : Text;
    description : Text;
    status : TicketStatus;
    replies : [TicketReply];
    createdAt : Int;
  };

  public type TicketAttachmentMeta = {
    id : Nat;
    ticketId : Nat;
    name : Text;
    contentType : Text;
    size : Nat;
    totalChunks : Nat;
    uploadedBy : Text;
    createdAt : Int;
  };

  public type TicketExtras = {
    company : Text;
    deviceNumber : Text;
  };

  public type PublicTicketView = {
    id : Nat;
    subject : Text;
    description : Text;
    status : TicketStatus;
    replies : [TicketReply];
    createdAt : Int;
    company : Text;
    deviceNumber : Text;
  };

  public type CalendarEventType = { #meeting; #trip; #importantDate; #task };

  public type CalendarEvent = {
    id : Nat;
    title : Text;
    description : Text;
    startDate : Text;
    endDate : Text;
    eventType : CalendarEventType;
    createdBy : Text;
    createdAt : Int;
    done : Bool;
  };

  public type TicketDriveAttachment = {
    id : Nat;
    ticketId : Nat;
    name : Text;
    oneDriveItemId : Text;
    uploadedBy : Text;
    createdAt : Int;
  };

  public type TicketLinks = {
    calendarEventId : ?Nat;
    driveFolderId : ?Nat;
  };

  public type CalendarNote = {
    id : Nat;
    eventId : Nat;
    title : Text;
    content : Text;
    createdAt : Int;
  };

  public type PendingInvoiceStatus = { #pending; #addedToWarehouse; #rejected };

  public type PendingInvoice = {
    ksefNumber : Text;
    invoiceNumber : Text;
    issueDate : Text;
    sellerNip : Text;
    sellerName : Text;
    netAmount : Float;
    grossAmount : Float;
    vatAmount : Float;
    currency : Text;
    status : PendingInvoiceStatus;
    importedAt : Int;
  };

  public type PendingInvoiceImportItem = {
    ksefNumber : Text;
    invoiceNumber : Text;
    issueDate : Text;
    sellerNip : Text;
    sellerName : Text;
    netAmount : Float;
    grossAmount : Float;
    vatAmount : Float;
    currency : Text;
  };

  public type InvoiceLineItem = {
    name : Text;
    quantity : Float;
    unit : Text;
  };

  public type OneDriveTokens = {
    accessToken : Text;
    refreshToken : Text;
    expiresAt : Int;
  };

  public type OneDriveItem = {
    id : Text;
    name : Text;
    isFolder : Bool;
    size : Nat;
    parentPath : Text;
    lastModified : Text;
  };

  public type Folder = {
    id : Nat;
    name : Text;
    parentId : ?Nat;
    createdBy : Text;
    createdAt : Int;
  };

  public type FileMeta = {
    id : Nat;
    name : Text;
    contentType : Text;
    size : Nat;
    totalChunks : Nat;
    parentId : ?Nat;
    uploadedBy : Text;
    createdAt : Int;
  };

  public type WarehouseItem = {
    id : Nat;
    name : Text;
    partDescription : Text;
    model : Text;
    link : Text;
    manufacturer : Text;
    serialNo : Text;
    category : Text;
    isReplacementPart : Bool;
    appliesFnpt2 : Bool;
    appliesTrainer : Bool;
    location : Text;
    note : Text;
    currentQuantity : Float;
    createdAt : Int;
  };

  public type MovementType = {
    #in_;
    #out_;
  };

  public type StockMovement = {
    id : Nat;
    itemId : Nat;
    movementType : MovementType;
    quantity : Float;
    projectId : ?Nat;
    performedBy : Text;
    date : Text;
    note : Text;
    createdAt : Int;
  };

  public type OrderStatus = { #pending; #completed; #cancelled };

  public type Order = {
    id : Nat;
    date : Text;
    name : Text;
    quantity : Float;
    supplierName : Text;
    totalAmount : Float;
    advanceAmount : Float;
    currency : Text;
    note : Text;
    status : OrderStatus;
    driveFolderId : ?Nat;
    createdBy : Text;
    createdAt : Int;
  };

  public type Contract = {
    id : Nat;
    title : Text;
    category : Text;
    counterparty : Text;
    description : Text;
    endDate : Text;
    driveFolderId : ?Nat;
    createdBy : Text;
    createdAt : Int;
  };

  public type Device = {
    id : Nat;
    symbol : Text;
    name : Text;
    client : Text;
    location : Text;
    notes : Text;
    purchaseDate : Text;
    warrantyDate : Text;
    supportPackage : Text;
    contactPerson : Text;
    flightHours : Nat;
    flightMinutes : Nat;
    createdBy : Text;
    createdAt : Int;
  };

  public type DeviceServiceEntry = {
    id : Nat;
    deviceId : Nat;
    date : Text;
    description : Text;
    performedBy : Text;
    createdAt : Int;
  };

  public type DeviceServiceEntryV2 = {
    id : Nat;
    deviceId : Nat;
    date : Text;
    description : Text;
    performedBy : Text;
    flightHours : Nat;
    flightMinutes : Nat;
    createdAt : Int;
  };

  public type Subscriber = {
    id : Nat;
    email : Text;
    name : Text;
    notifyUrgent : Bool;
    createdAt : Int;
  };

  public type Expense = {
    id : Nat;
    projectId : Nat;
    productService : Text;
    supplier : Text;
    serialNumber : Text;
    quantity : ?Nat;
    priceEur : ?Float;
    priceUsd : ?Float;
    pricePln : ?Float;
    priceNet : ?Float;
    orderDate : Text;
    paid : Bool;
    paidBy : Text;
    hasInvoice : Bool;
    invoiceNumber : Text;
    confirmed : Bool;
    ksefNote : Text;
    note : Text;
  };

  public type AiAgentConfigValue = {
    #bool : Bool;
    #text : Text;
    #number : Float;
  };

  public type AiAgentConfigEntry = {
    key : Text;
    value : AiAgentConfigValue;
    updatedBy : Principal;
    updatedAt : Int;
  };

  public type AiConfigAuditEntry = {
    principal : Principal;
    key : Text;
    oldValue : ?Text;
    newValue : Text;
    timestamp : Int;
  };

  public type FlaggedActionKind = {
    #orderMissingDriveFolder;
    #contractMissingDriveFolder;
    #expenseMissingInvoice;
    #ksefInvoicePendingTooLong;
    #expenseAmountAnomaly;
  };

  public type FlaggedAction = {
    kind : FlaggedActionKind;
    entityRef : Text;
    entityLabel : Text;
    detail : Text;
  };

  public type ProjectTemplateTask = {
    id : Nat;
    title : Text;
    category : Text;
    estimatedDays : Nat;
  };

  public type ProjectTemplate = {
    key : Text;
    title : Text;
    tasks : [ProjectTemplateTask];
  };

  public type WelcomeItemKind = {
    #newOrder;
    #newContract;
    #newCalendarEvent;
    #newKsefInvoice;
    #upcomingImportantDate;
  };

  public type WelcomeItem = {
    kind : WelcomeItemKind;
    entityRef : Text;
    entityLabel : Text;
    detail : Text;
  };
};
