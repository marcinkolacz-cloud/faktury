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

  public type CalendarNote = {
    id : Nat;
    eventId : Nat;
    title : Text;
    content : Text;
    createdAt : Int;
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
};
