import Map "mo:core/Map";
import List "mo:core/List";
import Types "../types";
import Principal "mo:core/Principal";
import Time "mo:core/Time";
import Runtime "mo:core/Runtime";
import Nat "mo:core/Nat";
import AccessLib "../lib/access";

// Archiwum rozmów z Agentem AI — prywatne per-user (każdy widzi i zarządza
// wyłącznie swoimi archiwalnymi rozmowami, nigdy cudzych). Wymaga tego
// samego dostępu co reszta agenta (rola + checkbox modułu "agent").
mixin (
  chatArchives : Map.Map<Nat, Types.ChatArchiveEntry>,
  currentConversations : Map.Map<Principal, Text>,
  accessRoles : Map.Map<Principal, Types.Role>,
  moduleAccess : Map.Map<Principal, [Text]>,
) {
  func requireChatArchiveAccess(caller : Principal) {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "agent")) { Runtime.trap("Module access required: agent"); };
  };

  // "Aktywna" rozmowa — osobny slot od archiwum, nadpisywany automatycznie
  // po każdej wymianie wiadomości, żeby po powrocie na stronę user widział
  // dokładnie tam gdzie skończył. Wyłącznie własna, nigdy cudza.
  public shared ({ caller }) func saveCurrentConversation(messagesJson : Text) : async () {
    requireChatArchiveAccess(caller);
    currentConversations.add(caller, messagesJson);
  };

  public query ({ caller }) func getCurrentConversation() : async ?Text {
    requireChatArchiveAccess(caller);
    currentConversations.get(caller);
  };

  public shared ({ caller }) func clearCurrentConversation() : async () {
    requireChatArchiveAccess(caller);
    currentConversations.remove(caller);
  };

  public shared ({ caller }) func archiveConversation(title : Text, messagesJson : Text) : async Nat {
    requireChatArchiveAccess(caller);
    var maxId = 0;
    var any = false;
    for ((id, _) in chatArchives.entries()) {
      if (not any or id >= maxId) { maxId := id; any := true; };
    };
    let newId = if (any) { maxId + 1 } else { 0 };
    chatArchives.add(newId, {
      id = newId;
      owner = caller;
      title;
      messagesJson;
      archivedAt = Time.now();
    });
    newId;
  };

  public query ({ caller }) func listMyArchivedConversations() : async [Types.ChatArchiveEntry] {
    requireChatArchiveAccess(caller);
    var result = List.empty<Types.ChatArchiveEntry>();
    for ((_, e) in chatArchives.entries()) {
      if (e.owner == caller) { result.add(e); };
    };
    result.toArray();
  };

  public query ({ caller }) func getArchivedConversation(id : Nat) : async ?Text {
    requireChatArchiveAccess(caller);
    switch (chatArchives.get(id)) {
      case (?e) { if (e.owner == caller) { ?e.messagesJson } else { null } };
      case null { null };
    };
  };

  public shared ({ caller }) func deleteArchivedConversation(id : Nat) : async Bool {
    requireChatArchiveAccess(caller);
    switch (chatArchives.get(id)) {
      case (?e) {
        if (e.owner != caller) { return false; };
        chatArchives.remove(id);
        true;
      };
      case null { false };
    };
  };
};
