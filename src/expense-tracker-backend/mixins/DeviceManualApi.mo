import Map "mo:core/Map";
import List "mo:core/List";
import Types "../types";
import Principal "mo:core/Principal";
import Time "mo:core/Time";
import Runtime "mo:core/Runtime";
import Nat "mo:core/Nat";
import Array "mo:core/Array";
import Text "mo:core/Text";
import AccessLib "../lib/access";

// Instrukcja obsługi per urządzenie — rozdziały przechowywane w kanistrze
// (zamiast plików HTML na dysku jak w desktopowym FSIOS). Odczyt = zwykły
// dostęp do modułu "devices". Edycja wymaga DODATKOWEJ, osobnej zgody
// (documentationEditors) nadawanej wyłącznie przez admina — sama ogólna
// rola "write" i checkbox modułu "devices" NIE wystarczają do edycji
// dokumentacji, to świadome, węższe uprawnienie.
mixin (
  deviceManualChapters : Map.Map<Nat, Types.DeviceManualChapter>,
  deviceManualChaptersTrashed : Map.Map<Nat, Int>,
  deviceManualEditLocks : Map.Map<Nat, (Principal, Int, Int)>,
  documentationEditors : Map.Map<Principal, Bool>,
  docHeaderFooterSettings : Map.Map<Text, Types.DocHeaderFooterSettings>,
  accessRoles : Map.Map<Principal, Types.Role>,
  moduleAccess : Map.Map<Principal, [Text]>,
) {
  func requireManualRead(caller : Principal) {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "devices")) { Runtime.trap("Module access required: devices"); };
  };

  func requireManualWrite(caller : Principal) {
    requireManualRead(caller);
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (documentationEditors.get(caller) != ?true) {
      Runtime.trap("Documentation edit permission required — ask an admin to grant it specifically for you");
    };
  };
  // Jednoosobowa blokada edycji per rozdział, żeby dwóch pracowników nie
  // nadpisywało sobie nawzajem treści. Zamek wygasa automatycznie po 30s
  // bez heartbeatu (np. zamknięcie karty bez kliknięcia "Zakończ edycję"),
  // więc nikt nie zostaje trwale zablokowany.
  let LOCK_TIMEOUT_NS : Int = 30_000_000_000;
  func lockIsActive(entry : (Principal, Int, Int)) : Bool {
    let (_, _, heartbeatAt) = entry;
    Time.now() - heartbeatAt < LOCK_TIMEOUT_NS;
  };
  public shared ({ caller }) func acquireEditLock(chapterId : Nat) : async Bool {
    requireManualWrite(caller);
    switch (deviceManualEditLocks.get(chapterId)) {
      case null {
        deviceManualEditLocks.add(chapterId, (caller, Time.now(), Time.now()));
        true;
      };
      case (?entry) {
        let (holder, _, _) = entry;
        if (holder == caller or not lockIsActive(entry)) {
          deviceManualEditLocks.add(chapterId, (caller, Time.now(), Time.now()));
          true;
        } else {
          false;
        };
      };
    };
  };
  public shared ({ caller }) func heartbeatEditLock(chapterId : Nat) : async Bool {
    requireManualWrite(caller);
    switch (deviceManualEditLocks.get(chapterId)) {
      case null { false };
      case (?entry) {
        let (holder, acquiredAt, _) = entry;
        if (holder == caller) {
          deviceManualEditLocks.add(chapterId, (caller, acquiredAt, Time.now()));
          true;
        } else {
          false;
        };
      };
    };
  };
  public shared ({ caller }) func releaseEditLock(chapterId : Nat) : async () {
    requireManualWrite(caller);
    switch (deviceManualEditLocks.get(chapterId)) {
      case (?entry) {
        let (holder, _, _) = entry;
        if (holder == caller) { deviceManualEditLocks.remove(chapterId); };
      };
      case null {};
    };
  };
  public query ({ caller }) func getEditLock(chapterId : Nat) : async ?Principal {
    requireManualRead(caller);
    switch (deviceManualEditLocks.get(chapterId)) {
      case (?entry) {
        if (lockIsActive(entry)) { let (holder, _, _) = entry; ?holder } else { null };
      };
      case null { null };
    };
  };

  // Admin-only: nadawanie/odbieranie prawa edycji dokumentacji, niezależnie
  // od roli i checkboxa modułu "devices" tej osoby.
  public shared ({ caller }) func setDocumentationEditor(target : Principal, allowed : Bool) : async () {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Admin access required"); };
    documentationEditors.add(target, allowed);
  };

  public query ({ caller }) func isDocumentationEditor(target : Principal) : async Bool {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Admin access required"); };
    documentationEditors.get(target) == ?true;
  };

  public query ({ caller }) func amIDocumentationEditor() : async Bool {
    requireManualRead(caller);
    documentationEditors.get(caller) == ?true;
  };

  public query ({ caller }) func listDocumentationEditors() : async [(Principal, Bool)] {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Admin access required"); };
    var result = List.empty<(Principal, Bool)>();
    for ((p, v) in documentationEditors.entries()) {
      if (v) { result.add((p, v)); };
    };
    result.toArray();
  };

  // Jeden, wspólny zestaw ustawień nagłówka/stopki dla wszystkich
  // eksportowanych dokumentów (klucz "default" — pojedynczy rekord).
  // Odczyt = zwykły dostęp do modułu "devices"; zapis wymaga tego samego
  // dedykowanego uprawnienia co edycja treści.
  public query ({ caller }) func getDocHeaderFooterSettings() : async ?Types.DocHeaderFooterSettings {
    requireManualRead(caller);
    docHeaderFooterSettings.get("default");
  };

  public shared ({ caller }) func setDocHeaderFooterSettings(
    headerText : Text,
    footerText : Text,
    logoDataUri : Text,
    skipFirstPage : Bool,
    showPageNumbers : Bool,
  ) : async () {
    requireManualWrite(caller);
    docHeaderFooterSettings.add("default", {
      headerText;
      footerText;
      logoDataUri;
      skipFirstPage;
      showPageNumbers;
      updatedBy = Principal.toText(caller);
      updatedAt = Time.now();
    });
  };

  public query ({ caller }) func listDeviceManualChapters(deviceId : Nat) : async [Types.DeviceManualChapter] {
    requireManualRead(caller);
    var result = List.empty<Types.DeviceManualChapter>();
    for ((_, ch) in deviceManualChapters.entries()) {
      if (ch.deviceId == deviceId and deviceManualChaptersTrashed.get(ch.id) == null) { result.add(ch); };
    };
    let arr = result.toArray();
    let n = arr.size();
    var sorted = arr;
    var i = 0;
    while (i < n) {
      var minIdx = i;
      var j = i + 1;
      while (j < n) {
        if (sorted[j].order < sorted[minIdx].order) { minIdx := j; };
        j += 1;
      };
      if (minIdx != i) {
        let tmp = sorted[i];
        sorted := Array.tabulate<Types.DeviceManualChapter>(n, func(k) {
          if (k == i) { sorted[minIdx] } else if (k == minIdx) { tmp } else { sorted[k] };
        });
      };
      i += 1;
    };
    sorted;
  };

  public shared ({ caller }) func createDeviceManualChapter(deviceId : Nat, title : Text) : async Nat {
    requireManualWrite(caller);
    var maxId = 0;
    var any = false;
    var maxOrder = 0;
    for ((id, ch) in deviceManualChapters.entries()) {
      if (not any or id >= maxId) { maxId := id; any := true; };
      if (ch.deviceId == deviceId and ch.order >= maxOrder) { maxOrder := ch.order + 1; };
    };
    let newId = if (any) { maxId + 1 } else { 0 };
    deviceManualChapters.add(newId, {
      id = newId;
      deviceId;
      title;
      contentHtml = "";
      order = maxOrder;
      updatedBy = "";
      updatedAt = Time.now();
    });
    newId;
  };

  public shared ({ caller }) func updateDeviceManualChapter(id : Nat, title : Text, contentHtml : Text, updatedBy : Text) : async Bool {
    requireManualWrite(caller);
    switch (deviceManualChapters.get(id)) {
      case (?ch) {
        deviceManualChapters.add(id, { ch with title; contentHtml; updatedBy; updatedAt = Time.now() });
        true;
      };
      case null { false };
    };
  };

  public shared ({ caller }) func moveDeviceManualChapter(id : Nat, direction : { #up; #down }) : async Bool {
    requireManualWrite(caller);
    switch (deviceManualChapters.get(id)) {
      case (?ch) {
        var neighborId : ?Nat = null;
        var neighborOrder = 0;
        for ((otherId, other) in deviceManualChapters.entries()) {
          if (other.deviceId == ch.deviceId and otherId != id) {
            let isCandidate = switch (direction) {
              case (#up) { other.order < ch.order and (neighborId == null or other.order > neighborOrder) };
              case (#down) { other.order > ch.order and (neighborId == null or other.order < neighborOrder) };
            };
            if (isCandidate) { neighborId := ?otherId; neighborOrder := other.order; };
          };
        };
        switch (neighborId) {
          case (?nId) {
            switch (deviceManualChapters.get(nId)) {
              case (?neighbor) {
                deviceManualChapters.add(id, { ch with order = neighbor.order });
                deviceManualChapters.add(nId, { neighbor with order = ch.order });
                true;
              };
              case null { false };
            };
          };
          case null { false };
        };
      };
      case null { false };
    };
  };

  public shared ({ caller }) func reorderDeviceManualChapters(deviceId : Nat, orderedIds : [Nat]) : async Bool {
    requireManualWrite(caller);
    var idx = 0;
    for (id in orderedIds.vals()) {
      switch (deviceManualChapters.get(id)) {
        case (?ch) {
          if (ch.deviceId == deviceId) {
            deviceManualChapters.add(id, { ch with order = idx });
          };
        };
        case null {};
      };
      idx += 1;
    };
    true;
  };

  // "Usuń" z UI = kosz (odwracalne), nie trwałe kasowanie — spójne z resztą
  // apki. Wymaga wpisania "DELETE" po stronie frontendu przed wywołaniem.
  public shared ({ caller }) func trashDeviceManualChapter(id : Nat) : async Bool {
    requireManualWrite(caller);
    switch (deviceManualChapters.get(id)) {
      case (?_) { deviceManualChaptersTrashed.add(id, Time.now()); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func restoreDeviceManualChapter(id : Nat) : async Bool {
    requireManualWrite(caller);
    switch (deviceManualChaptersTrashed.get(id)) {
      case (?_) { deviceManualChaptersTrashed.remove(id); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func permanentlyDeleteDeviceManualChapter(id : Nat) : async Bool {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can permanently delete"); };
    deviceManualChaptersTrashed.remove(id);
    switch (deviceManualChapters.get(id)) {
      case (?_) { deviceManualChapters.remove(id); true; };
      case null { false };
    };
  };

  public query ({ caller }) func listTrashedDeviceManualChapters() : async [Types.DeviceManualChapter] {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Admin access required"); };
    var result = List.empty<Types.DeviceManualChapter>();
    for ((id, _) in deviceManualChaptersTrashed.entries()) {
      switch (deviceManualChapters.get(id)) {
        case (?ch) { result.add(ch); };
        case null {};
      };
    };
    result.toArray();
  };
};
