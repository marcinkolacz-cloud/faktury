import Principal "mo:core/Principal";

module {
  public type AdvancePayment = {
    id : Nat;
    date : Text;
    amount : Float;
    currency : Text;
    note : Text;
    createdAt : Int;
    ownerId : Principal;
  };

  public type Project = {
    id : Nat;
    name : Text;
    createdAt : Int;
    ownerId : Principal;
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
    ownerId : Principal;
  };
};
