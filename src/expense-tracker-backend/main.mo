import Map "mo:core/Map";
import Set "mo:core/Set";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Types "types";
import InvitesLib "lib/invites";
import ProjectsApi "mixins/ProjectsApi";
import AdvancePaymentsApi "mixins/AdvancePaymentsApi";
import ExpensesApi "mixins/ExpensesApi";
import InvitesApi "mixins/InvitesApi";

persistent actor {
  let projects = Map.empty<Nat, Types.Project>();
  let advancePayments = Map.empty<Nat, Types.AdvancePayment>();
  let expenses = Map.empty<Nat, Types.Expense>();
  let inviteCodes = Map.empty<Text, InvitesLib.InviteCode>();
  let grantedPrincipals = Set.empty<Principal>();
  var adminPrincipal : ?Principal = null;

  include ProjectsApi(projects);
  include AdvancePaymentsApi(advancePayments);
  include ExpensesApi(expenses);
  func isAdmin(caller : Principal) : Bool {
    switch (adminPrincipal) {
      case (?admin) { Principal.equal(admin, caller) };
      case null { false };
    };
  };

  include InvitesApi(inviteCodes, grantedPrincipals, isAdmin);

  public shared ({ caller }) func setAdminPrincipal() : async () {
    switch (adminPrincipal) {
      case (?_) { Runtime.trap("Admin already set"); };
      case null {
        adminPrincipal := ?caller;
        grantedPrincipals.add(caller);
      };
    };
  };

  public query ({ caller }) func isCallerAdmin() : async Bool {
    switch (adminPrincipal) {
      case (?admin) { Principal.equal(admin, caller) };
      case null { false };
    };
  };
};
