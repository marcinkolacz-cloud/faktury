import Map "mo:core/Map";
import List "mo:core/List";
import Types "../types";
import Principal "mo:core/Principal";
import Time "mo:core/Time";
import Runtime "mo:core/Runtime";
import Nat "mo:core/Nat";
import Array "mo:core/Array";
import Text "mo:core/Text";
import Blob "mo:core/Blob";
import Random "mo:core/Random";
import Nat8 "mo:core/Nat8";
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
  deviceManualChapterUploadBuffers : Map.Map<Nat, Text>,
  documentationEditors : Map.Map<Principal, Bool>,
  docHeaderFooterSettings : Map.Map<Text, Types.DocHeaderFooterSettings>,
  deviceManualVariables : Map.Map<Nat, [Types.ManualVariable]>,
  deviceManualChapterBackupEnabled : Map.Map<Nat, Bool>,
  deviceManualChapterBackupTrash : Map.Map<Nat, (Text, Int)>,
  docFolders : Map.Map<Nat, (Text, Principal, Int)>,
  accessRoles : Map.Map<Principal, Types.Role>,
  moduleAccess : Map.Map<Principal, [Text]>,
  documentBooks : Map.Map<Nat, Types.DocumentBook>,
  chapterBookId : Map.Map<Nat, Nat>,
  bookManualVariables : Map.Map<Nat, [Types.ManualVariable]>,
  bookHeaderFooterSettings : Map.Map<Nat, Types.DocHeaderFooterSettings>,
  // Obrazki dokumentacji przechowywane jako surowe bajty na kanistrze
  // (zamiast OneDrive) — droga na zniknięcie obrazków z kopii backupu,
  // bez narzutu base64 (chunkowany upload jak przy legacy tresci
  // rozdzialow, patrz beginChapterUpload/appendChapterChunk wyzej).
  deviceManualImages : Map.Map<Text, Blob>,
  deviceManualImageContentType : Map.Map<Text, Text>,
  deviceManualImageUploadBuffers : Map.Map<Text, List.List<Nat8>>,
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

  // Własny folder dokumentacji, niepowiązany z urządzeniem/projektem —
  // dostępny dla każdego z dostępem do modułu devices (jak reszta odczytu
  // dokumentacji). Rozdziały w takim folderze działają identycznie jak dla
  // urządzenia (deviceId jest tu numerem folderu, oznaczonym z dużym
  // przesunięciem żeby nie kolidował z prawdziwymi id urządzeń).
  public shared ({ caller }) func addDocFolder(name : Text) : async Nat {
    requireManualRead(caller);
    if (Text.size(Text.trim(name, #char ' ')) == 0) { Runtime.trap("Nazwa folderu jest wymagana"); };
    var maxId = 0;
    var any = false;
    for ((id, _) in docFolders.entries()) {
      if (not any or id >= maxId) { maxId := id; any := true; };
    };
    let newId = if (any) { maxId + 1 } else { 0 };
    docFolders.add(newId, (Text.trim(name, #char ' '), caller, Time.now()));
    newId;
  };

  public query ({ caller }) func listDocFolders() : async [(Nat, Text, Principal, Int)] {
    requireManualRead(caller);
    let result = List.empty<(Nat, Text, Principal, Int)>();
    for ((id, entry) in docFolders.entries()) {
      let (name, owner, createdAt) = entry;
      result.add((id, name, owner, createdAt));
    };
    List.toArray(result);
  };

  // --- Książki (poziom pomiędzy urządzeniem a rozdziałem) ---
  // Jedno urządzenie może mieć kilka oddzielnych podręczników; każdy ma
  // własne rozdziały, zmienne referencyjne i nagłówek/stopkę — nic nie jest
  // dzielone między książkami tego samego urządzenia.

  public shared ({ caller }) func addBook(deviceId : Nat, title : Text) : async Nat {
    requireManualWrite(caller);
    let trimmed = Text.trim(title, #char ' ');
    if (Text.size(trimmed) == 0) { Runtime.trap("Nazwa książki jest wymagana"); };
    var maxId = 0;
    var any = false;
    for ((id, _) in documentBooks.entries()) {
      if (not any or id >= maxId) { maxId := id; any := true; };
    };
    let newId = if (any) { maxId + 1 } else { 0 };
    var maxOrder = 0;
    for ((_, b) in documentBooks.entries()) {
      if (b.deviceId == deviceId and b.order >= maxOrder) { maxOrder := b.order + 1; };
    };
    documentBooks.add(newId, { id = newId; deviceId; title = trimmed; order = maxOrder });
    newId;
  };

  public shared ({ caller }) func renameBook(bookId : Nat, title : Text) : async Bool {
    requireManualWrite(caller);
    let trimmed = Text.trim(title, #char ' ');
    if (Text.size(trimmed) == 0) { Runtime.trap("Nazwa książki jest wymagana"); };
    switch (documentBooks.get(bookId)) {
      case (?b) { documentBooks.add(bookId, { b with title = trimmed }); true };
      case null { false };
    };
  };

  public shared ({ caller }) func deleteBook(bookId : Nat) : async Bool {
    requireManualWrite(caller);
    var hasChapters = false;
    for ((_, bid) in chapterBookId.entries()) {
      if (bid == bookId) { hasChapters := true; };
    };
    if (hasChapters) { Runtime.trap("Nie można usunąć książki, która ma jeszcze rozdziały — przenieś lub usuń je najpierw"); };
    switch (documentBooks.get(bookId)) {
      case (?_) { documentBooks.remove(bookId); bookManualVariables.remove(bookId); bookHeaderFooterSettings.remove(bookId); true };
      case null { false };
    };
  };

  // Migracja: pierwsze wejście do urządzenia bez żadnej książki tworzy
  // "Książka 1" i przypisuje do niej wszystkie istniejące (jeszcze
  // nieprzypisane) rozdziały tego urządzenia — nic nie znika z listy.
  public shared ({ caller }) func ensureDefaultBook(deviceId : Nat) : async Nat {
    requireManualWrite(caller);
    for ((_, b) in documentBooks.entries()) {
      if (b.deviceId == deviceId) { return b.id; };
    };
    var maxId = 0;
    var any = false;
    for ((id, _) in documentBooks.entries()) {
      if (not any or id >= maxId) { maxId := id; any := true; };
    };
    let newId = if (any) { maxId + 1 } else { 0 };
    documentBooks.add(newId, { id = newId; deviceId; title = "Książka 1"; order = 0 });
    for ((chId, ch) in deviceManualChapters.entries()) {
      if (ch.deviceId == deviceId and chapterBookId.get(chId) == null) {
        chapterBookId.add(chId, newId);
      };
    };
    // Migracja istniejących zmiennych referencyjnych / nagłówka-stopki
    // urządzenia do nowej domyślnej książki, żeby nic nie zniknęło.
    switch (deviceManualVariables.get(deviceId)) {
      case (?vars) { bookManualVariables.add(newId, vars); };
      case null {};
    };
    switch (docHeaderFooterSettings.get("default")) {
      case (?s) { bookHeaderFooterSettings.add(newId, s); };
      case null {};
    };
    newId;
  };

  public query ({ caller }) func listBooks(deviceId : Nat) : async [Types.DocumentBook] {
    requireManualRead(caller);
    var result = List.empty<Types.DocumentBook>();
    for ((_, b) in documentBooks.entries()) {
      if (b.deviceId == deviceId) { result.add(b); };
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
        sorted := Array.tabulate<Types.DocumentBook>(n, func(k) {
          if (k == i) { sorted[minIdx] } else if (k == minIdx) { tmp } else { sorted[k] };
        });
      };
      i += 1;
    };
    sorted;
  };

  // @deprecated: nieużywana przez frontend — zastąpiona przez zbiorczy
  // getDeviceChapterBookMap (mapa wszystkich rozdziałów urządzenia naraz).
  // Nie usunięto (redeploy zmienia interfejs candid) — do usunięcia przy
  // najbliższym świadomym redeployu backendu.
  public query ({ caller }) func getChapterBook(chapterId : Nat) : async ?Nat {
    requireManualRead(caller);
    chapterBookId.get(chapterId);
  };

  public shared ({ caller }) func setChapterBook(chapterId : Nat, bookId : Nat) : async Bool {
    requireManualWrite(caller);
    if (documentBooks.get(bookId) == null) { return false; };
    switch (deviceManualChapters.get(chapterId)) {
      case (?_) { chapterBookId.add(chapterId, bookId); true };
      case null { false };
    };
  };

  // @deprecated: nieużywana przez frontend — zastąpiona przez zbiorczy
  // getDeviceChapterBookMap. Nie usunięto (redeploy zmienia interfejs candid).
  public query ({ caller }) func listChaptersByBook(bookId : Nat) : async [Nat] {
    requireManualRead(caller);
    var result = List.empty<Nat>();
    for ((chId, bid) in chapterBookId.entries()) {
      if (bid == bookId) { result.add(chId); };
    };
    result.toArray();
  };

  // Cała mapa rozdział→książka dla urządzenia w jednym wywołaniu — używane
  // przez drzewko w sidebarze, żeby nie robić N zapytań (po jednym na książkę).
  public query ({ caller }) func getDeviceChapterBookMap(deviceId : Nat) : async [(Nat, Nat)] {
    requireManualRead(caller);
    var result = List.empty<(Nat, Nat)>();
    for ((chId, ch) in deviceManualChapters.entries()) {
      if (ch.deviceId == deviceId) {
        switch (chapterBookId.get(chId)) {
          case (?bid) { result.add((chId, bid)); };
          case null {};
        };
      };
    };
    result.toArray();
  };

  public query ({ caller }) func getBookManualVariables(bookId : Nat) : async [Types.ManualVariable] {
    requireManualRead(caller);
    switch (bookManualVariables.get(bookId)) { case (?v) v; case null [] };
  };

  public shared ({ caller }) func setBookManualVariables(bookId : Nat, vars : [Types.ManualVariable]) : async () {
    requireManualWrite(caller);
    bookManualVariables.add(bookId, vars);
  };

  public shared ({ caller }) func setBookManualVariableValue(bookId : Nat, key : Text, newValue : Text) : async () {
    requireManualWrite(caller);
    let vars = switch (bookManualVariables.get(bookId)) { case (?v) v; case null [] };
    let updated = Array.map<Types.ManualVariable, Types.ManualVariable>(vars, func(v) {
      if (v.key == key) { { v with currentValue = newValue } } else { v };
    });
    bookManualVariables.add(bookId, updated);
  };

  public query ({ caller }) func getBookHeaderFooterSettings(bookId : Nat) : async ?Types.DocHeaderFooterSettings {
    requireManualRead(caller);
    bookHeaderFooterSettings.get(bookId);
  };

  public shared ({ caller }) func setBookHeaderFooterSettings(
    bookId : Nat,
    headerText : Text,
    footerText : Text,
    logoDataUri : Text,
    skipFirstPage : Bool,
    showPageNumbers : Bool,
  ) : async () {
    requireManualWrite(caller);
    bookHeaderFooterSettings.add(bookId, {
      headerText; footerText; logoDataUri; skipFirstPage; showPageNumbers;
      updatedBy = Principal.toText(caller);
      updatedAt = Time.now();
    });
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
  // @deprecated: nieużywana przez frontend — zastąpiona przez book-scoped
  // getBookHeaderFooterSettings. Nie usunięto (redeploy zmienia candid).
  public query ({ caller }) func getDocHeaderFooterSettings() : async ?Types.DocHeaderFooterSettings {
    requireManualRead(caller);
    docHeaderFooterSettings.get("default");
  };

  // @deprecated: nieużywana przez frontend — zastąpiona przez book-scoped
  // setBookHeaderFooterSettings. Nie usunięto (redeploy zmienia candid).
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

  public query ({ caller }) func listDeviceManualChaptersMeta(deviceId : Nat) : async [Types.DeviceManualChapter] {
    requireManualRead(caller);
    var result = List.empty<Types.DeviceManualChapter>();
    for ((_, ch) in deviceManualChapters.entries()) {
      if (ch.deviceId == deviceId and deviceManualChaptersTrashed.get(ch.id) == null) {
        result.add({ ch with contentHtml = "" });
      };
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

  public query ({ caller }) func getDeviceManualChapterContent(id : Nat) : async ?Text {
    requireManualRead(caller);
    switch (deviceManualChapters.get(id)) {
      case (?ch) { ?ch.contentHtml };
      case null { null };
    };
  };

  public query ({ caller }) func getDeviceManualChapterContentLength(id : Nat) : async ?Nat {
    requireManualRead(caller);
    switch (deviceManualChapters.get(id)) {
      case (?ch) { ?Text.size(ch.contentHtml) };
      case null { null };
    };
  };

  public query ({ caller }) func getDeviceManualChapterContentChunk(id : Nat, start : Nat, len : Nat) : async ?Text {
    requireManualRead(caller);
    switch (deviceManualChapters.get(id)) {
      case (?ch) {
        let chars = Text.toArray(ch.contentHtml);
        let n = chars.size();
        if (start >= n) { return ?"" };
        let endIdx = if (start + len > n) n else start + len;
        let slice = Array.tabulate<Char>(endIdx - start, func(i : Nat) : Char { chars[start + i] });
        ?Text.fromArray(slice);
      };
      case null { null };
    };
  };

  public shared ({ caller }) func createDeviceManualChapter(deviceId : Nat, title : Text, bookId : Nat) : async Nat {
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
    chapterBookId.add(newId, bookId);
    newId;
  };

  public shared ({ caller }) func updateDeviceManualChapter(id : Nat, title : Text, contentHtml : Text, updatedBy : Text) : async Bool {
    requireManualWrite(caller);
    switch (deviceManualEditLocks.get(id)) {
      case (?entry) {
        let (holder, _, _) = entry;
        if (holder != caller and lockIsActive(entry)) {
          Runtime.trap("Edit lock held by another user — refresh and re-acquire the lock before saving");
        };
      };
      case null {};
    };
    switch (deviceManualChapters.get(id)) {
      case (?ch) {
        deviceManualChapters.add(id, { ch with title; contentHtml; updatedBy; updatedAt = Time.now() });
        true;
      };
      case null { false };
    };
  };

  func requireManualLockOk(caller : Principal, id : Nat) {
    requireManualWrite(caller);
    switch (deviceManualEditLocks.get(id)) {
      case (?entry) {
        let (holder, _, _) = entry;
        if (holder != caller and lockIsActive(entry)) {
          Runtime.trap("Edit lock held by another user — refresh and re-acquire the lock before saving");
        };
      };
      case null {};
    };
  };

  public shared ({ caller }) func beginChapterUpload(id : Nat) : async Bool {
    requireManualLockOk(caller, id);
    deviceManualChapterUploadBuffers.add(id, "");
    true;
  };

  public shared ({ caller }) func appendChapterChunk(id : Nat, chunk : Text) : async Bool {
    requireManualLockOk(caller, id);
    let prev = switch (deviceManualChapterUploadBuffers.get(id)) { case (?b) b; case null "" };
    deviceManualChapterUploadBuffers.add(id, prev # chunk);
    true;
  };

  public shared ({ caller }) func commitChapterUpload(id : Nat, title : Text, updatedBy : Text) : async Bool {
    requireManualLockOk(caller, id);
    let contentHtml = switch (deviceManualChapterUploadBuffers.get(id)) { case (?b) b; case null "" };
    deviceManualChapterUploadBuffers.remove(id);
    switch (deviceManualChapters.get(id)) {
      case (?ch) {
        deviceManualChapters.add(id, { ch with title; contentHtml; updatedBy; updatedAt = Time.now() });
        true;
      };
      case null { false };
    };
  };

  public shared ({ caller }) func updateDeviceManualChapterMeta(id : Nat, title : Text, updatedBy : Text) : async Bool {
    requireManualLockOk(caller, id);
    switch (deviceManualChapters.get(id)) {
      case (?ch) {
        // BYLO: "contentHtml = """ tutaj kasowalo kopie on-chain (backup)
        // przy KAZDYM zapisie rozdzialu (auto-zapis co 3s, "Zapisz",
        // "Odswiez i zapisz") - mimo ze ta funkcja mia byc "metadata-only".
        // To byl realny root cause znikajacego backupu ("kanister") po
        // zwyklej edycji tresci na OneDrive.
        deviceManualChapters.add(id, { ch with title; updatedBy; updatedAt = Time.now() });
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

  // === Zmienne referencyjne per urządzenie (panel "Wstaw do dokumentu") ===
  // Panel to osobne narzędzie — nie jest częścią treści, nie jest drukowane,
  // nie ma podglądu. Tabela referencji zawsze odzwierciedla aktualny stan
  // dokumentu (currentValue = to co faktycznie jest wpisane w treści).
  // Wyszukiwanie działa WYŁĄCZNIE na rozdziałach z aktywną kopią backend
  // (deviceManualChapterBackupEnabled), bo tylko tam backend ma treść.

  // @deprecated: nieużywana przez frontend — zastąpiona przez book-scoped
  // getBookManualVariables. Nie usunięto (redeploy zmienia candid).
  public query ({ caller }) func getDeviceManualVariables(deviceId : Nat) : async [Types.ManualVariable] {
    requireManualRead(caller);
    switch (deviceManualVariables.get(deviceId)) {
      case (?vars) { vars };
      case null { [] };
    };
  };

  // @deprecated: nieużywana przez frontend — zastąpiona przez book-scoped
  // setBookManualVariables. Nie usunięto (redeploy zmienia candid).
  public shared ({ caller }) func setDeviceManualVariables(deviceId : Nat, vars : [Types.ManualVariable]) : async () {
    requireManualWrite(caller);
    deviceManualVariables.add(deviceId, vars);
  };

  // Checkbox "Zarchiwizuj na backend" — sam checkbox tylko oznacza intencję;
  // faktyczna treść trafia do backendu dopiero przez saveChapterBackup,
  // wywoływane na żądanie (nigdy automatycznie w trakcie pisania).
  public shared ({ caller }) func setChapterBackupEnabled(chapterId : Nat, enabled : Bool) : async Bool {
    requireManualWrite(caller);
    switch (deviceManualChapters.get(chapterId)) {
      case (?_) {
        deviceManualChapterBackupEnabled.add(chapterId, enabled);
        if (not enabled) {
          // Wyłączenie kopii = kopia trafia do kosza admina (nie kasujemy
          // trwale od razu), a treść bieżącego rozdziału jest czyszczona.
          switch (deviceManualChapters.get(chapterId)) {
            case (?ch) {
              if (Text.size(ch.contentHtml) > 0) {
                deviceManualChapterBackupTrash.add(chapterId, (ch.contentHtml, Time.now()));
              };
              deviceManualChapters.add(chapterId, { ch with contentHtml = "" });
            };
            case null {};
          };
        };
        true;
      };
      case null { false };
    };
  };

  public query ({ caller }) func listTrashedChapterBackups() : async [(Nat, Text, Int)] {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Tylko admin ma dostęp do kosza") };
    var result = List.empty<(Nat, Text, Int)>();
    for ((id, (_, ts)) in deviceManualChapterBackupTrash.entries()) {
      let title = switch (deviceManualChapters.get(id)) {
        case (?ch) { ch.title };
        case null { "(usunięty rozdział #" # Nat.toText(id) # ")" };
      };
      result.add((id, title, ts));
    };
    List.toArray(result);
  };

  public shared ({ caller }) func restoreChapterBackup(chapterId : Nat) : async Bool {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Tylko admin ma dostęp do kosza") };
    switch (deviceManualChapterBackupTrash.get(chapterId)) {
      case (?(content, _)) {
        switch (deviceManualChapters.get(chapterId)) {
          case (?ch) { deviceManualChapters.add(chapterId, { ch with contentHtml = content }); };
          case null {};
        };
        deviceManualChapterBackupEnabled.add(chapterId, true);
        deviceManualChapterBackupTrash.remove(chapterId);
        true;
      };
      case null { false };
    };
  };

  public shared ({ caller }) func permanentlyDeleteChapterBackup(chapterId : Nat) : async Bool {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Tylko admin ma dostęp do kosza") };
    deviceManualChapterBackupTrash.remove(chapterId);
    true;
  };

  public query ({ caller }) func getChapterBackupEnabled(chapterId : Nat) : async Bool {
    requireManualRead(caller);
    deviceManualChapterBackupEnabled.get(chapterId) == ?true;
  };

  // Nadpisuje kopię on-chain rozdziału jedną, aktualną wersją (bez historii).
  // Wymaga wcześniejszego setChapterBackupEnabled(id, true).
  public shared ({ caller }) func saveChapterBackup(chapterId : Nat, contentHtml : Text) : async Bool {
    requireManualLockOk(caller, chapterId);
    if (deviceManualChapterBackupEnabled.get(chapterId) != ?true) {
      Runtime.trap("Backup nie jest włączony dla tego rozdziału — zaznacz checkbox przed zapisem");
    };
    switch (deviceManualChapters.get(chapterId)) {
      case (?ch) {
        deviceManualChapters.add(chapterId, { ch with contentHtml; updatedAt = Time.now() });
        true;
      };
      case null { false };
    };
  };

  // Buduje znormalizowaną wersję tekstu do PORÓWNANIA (dekoduje literalne "&nbsp;"
  // jako spację, zwija ciągi białych znaków do pojedynczej spacji) razem z mapą
  // norm-index -> raw-index, żeby dopasowanie działało mimo niełamliwych spacji
  // wstawianych przez edytor WYSIWYG, a podmiana i tak operowała na surowym HTML.
  func normalizeForSearch(raw : Text) : (Text, [Nat]) {
    let rChars = Text.toArray(raw);
    let n = rChars.size();
    var normChars = List.empty<Char>();
    var mapping = List.empty<Nat>();
    var lastWasSpace = false;
    var i = 0;
    while (i < n) {
      if (rChars[i] == '<') {
        // Pomijamy cały znacznik HTML (do najbliższego '>') — formatowanie
        // w środku frazy (np. pogrubione jedno słowo) nie przerywa dopasowania.
        var k = i + 1;
        while (k < n and rChars[k] != '>') { k += 1; };
        i := if (k < n) { k + 1 } else { n };
      } else if (i + 6 <= n and rChars[i] == '&' and rChars[i + 1] == 'n' and rChars[i + 2] == 'b' and rChars[i + 3] == 's' and rChars[i + 4] == 'p' and rChars[i + 5] == ';') {
        if (not lastWasSpace) { normChars.add(' '); mapping.add(i); lastWasSpace := true; };
        i += 6;
      } else {
        let c = rChars[i];
        let isSpace = (c == ' ' or c == '\t' or c == '\n' or c == '\r');
        if (isSpace) {
          if (not lastWasSpace) { normChars.add(' '); mapping.add(i); lastWasSpace := true; };
        } else {
          normChars.add(c);
          mapping.add(i);
          lastWasSpace := false;
        };
        i += 1;
      };
    };
    (Text.fromArray(normChars.toArray()), mapping.toArray());
  };

  // Zwraca listę (rawStart, rawLen) — pozycję i rzeczywistą długość dopasowania
  // w SUROWYM html (może być dłuższa niż szukany tekst, jeśli w środku była
  // encja &nbsp; albo kilka spacji zwiniętych do jednej przy porównaniu).
  func findAllOccurrences(haystackRaw : Text, needleRaw : Text) : [(Nat, Nat)] {
    let (normHay, mapping) = normalizeForSearch(haystackRaw);
    let (normNeedle, _) = normalizeForSearch(needleRaw);
    let hChars = Text.toArray(normHay);
    let nChars = Text.toArray(normNeedle);
    let hLen = hChars.size();
    let nLen = nChars.size();
    let rawLen = Text.size(haystackRaw);
    var result = List.empty<(Nat, Nat)>();
    if (nLen == 0 or nLen > hLen) { return result.toArray(); };
    var i = 0;
    while (i <= hLen - nLen) {
      var matched = true;
      var j = 0;
      while (j < nLen) {
        if (hChars[i + j] != nChars[j]) { matched := false; };
        j += 1;
      };
      if (matched) {
        let rawStart = mapping[i];
        let rawEnd = if (i + nLen < mapping.size()) { mapping[i + nLen] } else { rawLen };
        result.add((rawStart, rawEnd - rawStart));
      };
      i += 1;
    };
    result.toArray();
  };

  func extractContext(haystack : Text, idx : Nat, matchLen : Nat) : Text {
    let hChars = Text.toArray(haystack);
    let hLen = hChars.size();
    let ctxLen = 40;
    let start = if (idx > ctxLen) { idx - ctxLen } else { 0 };
    let endIdx = if (idx + matchLen + ctxLen > hLen) { hLen } else { idx + matchLen + ctxLen };
    let slice = Array.tabulate<Char>(endIdx - start, func(k : Nat) : Char { hChars[start + k] });
    Text.fromArray(slice);
  };

  func replaceAt(haystack : Text, idx : Nat, oldLen : Nat, newValue : Text) : Text {
    let hChars = Text.toArray(haystack);
    let hLen = hChars.size();
    let newChars = Text.toArray(newValue);
    let newLen = newChars.size();
    let afterStart = idx + oldLen;
    let afterLen : Nat = if (hLen > afterStart) { hLen - afterStart } else { 0 };
    let totalLen = idx + newLen + afterLen;
    let result = Array.tabulate<Char>(totalLen, func(k : Nat) : Char {
      if (k < idx) { hChars[k] }
      else if (k < idx + newLen) { newChars[k - idx] }
      else { hChars[afterStart + (k - idx - newLen)] };
    });
    Text.fromArray(result);
  };

  // Szuka searchText we wszystkich rozdziałach urządzenia z aktywnym backupem.
  // 0 trafień / 1 trafienie / wiele trafień — rozstrzyga o tym frontend
  // (auto-podmiana vs modal wyboru), backend tylko zwraca listę z kontekstem.
  // @deprecated: nieużywana przez frontend — wyszukiwanie zmiennych działa
  // teraz client-side po realnym DOM. Nie usunięto (redeploy zmienia candid).
  public query ({ caller }) func findManualVariableOccurrences(deviceId : Nat, searchText : Text) : async [Types.ManualVariableMatch] {
    requireManualRead(caller);
    var result = List.empty<Types.ManualVariableMatch>();
    if (Text.size(searchText) == 0) { return result.toArray(); };
    for ((id, ch) in deviceManualChapters.entries()) {
      if (ch.deviceId == deviceId and deviceManualChapterBackupEnabled.get(id) == ?true and deviceManualChaptersTrashed.get(id) == null) {
        let positions = findAllOccurrences(ch.contentHtml, searchText);
        for ((pos, len) in positions.vals()) {
          result.add({
            chapterId = id;
            chapterTitle = ch.title;
            contextSnippet = extractContext(ch.contentHtml, pos, len);
            occurrenceIndex = pos;
            matchedLength = len;
          });
        };
      };
    };
    result.toArray();
  };

  // Zbiorczy odczyt statusu backupu dla wszystkich rozdziałów urządzenia —
  // jedno wywołanie zamiast N zapytań (jedno per rozdział).
  public query ({ caller }) func getDeviceManualChapterBackupFlags(deviceId : Nat) : async [(Nat, Bool)] {
    requireManualRead(caller);
    var result = List.empty<(Nat, Bool)>();
    for ((id, ch) in deviceManualChapters.entries()) {
      if (ch.deviceId == deviceId and deviceManualChaptersTrashed.get(id) == null) {
        result.add((id, deviceManualChapterBackupEnabled.get(id) == ?true and Text.size(ch.contentHtml) > 0));
      };
    };
    result.toArray();
  };

  // Podmienia searchText -> newValue tylko we wskazanych (przez operatora)
  // wystąpieniach, aktualizuje referencję (currentValue) dla danego klucza.
  // Podmiana idzie od najwyższego occurrenceIndex w danym rozdziale, żeby
  // wcześniejsze podmiany nie przesuwały indeksów kolejnych. Długość podmiany
  // bierzemy z matchedLength (nie z długości searchText) — mogą się różnić,
  // gdy trafienie objęło &nbsp; albo kilka spacji zwiniętych przy wyszukiwaniu.
  // @deprecated: nieużywana przez frontend — zamiana zmiennych działa teraz
  // client-side po realnym DOM. Nie usunięto (redeploy zmienia candid).
  public shared ({ caller }) func applyManualVariableReplace(
    deviceId : Nat,
    key : Text,
    searchText : Text,
    newValue : Text,
    matches : [Types.ManualVariableMatch],
  ) : async Bool {
    requireManualWrite(caller);
    var byChapter = Map.empty<Nat, [(Nat, Nat)]>();
    for (m in matches.vals()) {
      let prev = switch (byChapter.get(m.chapterId)) { case (?p) p; case null [] };
      byChapter.add(m.chapterId, Array.concat(prev, [(m.occurrenceIndex, m.matchedLength)]));
    };
    for ((chapterId, indices) in byChapter.entries()) {
      switch (deviceManualChapters.get(chapterId)) {
        case (?ch) {
          if (ch.deviceId == deviceId) {
            var sortedDesc = indices;
            let n = sortedDesc.size();
            var i = 0;
            while (i < n) {
              var maxIdx = i;
              var j = i + 1;
              while (j < n) {
                if (sortedDesc[j].0 > sortedDesc[maxIdx].0) { maxIdx := j; };
                j += 1;
              };
              if (maxIdx != i) {
                let tmp = sortedDesc[i];
                sortedDesc := Array.tabulate<(Nat, Nat)>(n, func(k) {
                  if (k == i) { sortedDesc[maxIdx] } else if (k == maxIdx) { tmp } else { sortedDesc[k] };
                });
              };
              i += 1;
            };
            var content = ch.contentHtml;
            for ((idx, len) in sortedDesc.vals()) {
              content := replaceAt(content, idx, len, newValue);
            };
            deviceManualChapters.add(chapterId, { ch with contentHtml = content; updatedAt = Time.now() });
          };
        };
        case null {};
      };
    };
    // Referencja = aktualny stan dokumentu -> nadpisz currentValue dla klucza
    let vars = switch (deviceManualVariables.get(deviceId)) { case (?v) v; case null [] };
    let updated = Array.map<Types.ManualVariable, Types.ManualVariable>(vars, func(v) {
      if (v.key == key) { { v with currentValue = newValue } } else { v };
    });
    deviceManualVariables.add(deviceId, updated);
    true;
  };

  // Zapisuje gotowe (przygotowane przez frontend przy użyciu prawdziwego DOM
  // przeglądarki) nowe treści rozdziałów po podmianie referencji. Zastępuje
  // ręczne stripowanie HTML w Motoko, które nie radziło sobie ze wszystkimi
  // przypadkami (zagnieżdżone tagi, encje) — przeglądarka robi to poprawnie.
  // @deprecated: nieużywana przez frontend — zastąpiona przez book-scoped
  // setBookManualVariableValue. Nie usunięto (redeploy zmienia candid).
  public shared ({ caller }) func setManualVariableValue(deviceId : Nat, key : Text, newValue : Text) : async () {
    requireManualWrite(caller);
    let vars = switch (deviceManualVariables.get(deviceId)) { case (?v) v; case null [] };
    let updated = Array.map<Types.ManualVariable, Types.ManualVariable>(vars, func(v) {
      if (v.key == key) { { v with currentValue = newValue } } else { v };
    });
    deviceManualVariables.add(deviceId, updated);
  };

  // @deprecated: nieużywana przez frontend — zamiana zmiennych działa teraz
  // client-side po realnym DOM. Nie usunięto (redeploy zmienia candid).
  public shared ({ caller }) func applyManualVariableReplaceContents(
    deviceId : Nat,
    key : Text,
    newValue : Text,
    updatedChapters : [(Nat, Text)],
  ) : async Bool {
    requireManualWrite(caller);
    for ((chapterId, newHtml) in updatedChapters.vals()) {
      switch (deviceManualChapters.get(chapterId)) {
        case (?ch) {
          if (ch.deviceId == deviceId) {
            deviceManualChapters.add(chapterId, { ch with contentHtml = newHtml; updatedAt = Time.now() });
          };
        };
        case null {};
      };
    };
    let vars2 = switch (deviceManualVariables.get(deviceId)) { case (?v) v; case null [] };
    let updated2 = Array.map<Types.ManualVariable, Types.ManualVariable>(vars2, func(v) {
      if (v.key == key) { { v with currentValue = newValue } } else { v };
    });
    deviceManualVariables.add(deviceId, updated2);
    true;
  };

  // --- Import (kopia zapasowa) ---

  public shared ({ caller }) func importDocFolders(rows : [(Nat, Text, Principal, Int)], overwrite : Bool) : async Nat {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can import data"); };
    var count = 0;
    for ((id, name, owner, createdAt) in rows.vals()) {
      switch (docFolders.get(id)) {
        case (?_) { if (overwrite) { docFolders.add(id, (name, owner, createdAt)); count += 1; }; };
        case null { docFolders.add(id, (name, owner, createdAt)); count += 1; };
      };
    };
    count;
  };

  public shared ({ caller }) func importDeviceManualChapters(rows : [Types.DeviceManualChapter], overwrite : Bool) : async Nat {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can import data"); };
    var count = 0;
    for (ch in rows.vals()) {
      switch (deviceManualChapters.get(ch.id)) {
        case (?_) { if (overwrite) { deviceManualChapters.add(ch.id, ch); count += 1; }; };
        case null { deviceManualChapters.add(ch.id, ch); count += 1; };
      };
    };
    count;
  };

  public shared ({ caller }) func importTrashedDeviceManualChapters(entries : [(Nat, Int)], overwrite : Bool) : async Nat {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can import data"); };
    var count = 0;
    for ((id, ts) in entries.vals()) {
      switch (deviceManualChaptersTrashed.get(id)) {
        case (?_) { if (overwrite) { deviceManualChaptersTrashed.add(id, ts); count += 1; }; };
        case null { deviceManualChaptersTrashed.add(id, ts); count += 1; };
      };
    };
    count;
  };

  public query ({ caller }) func listTrashedDeviceManualChapterEntries() : async [(Nat, Int)] {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Admin access required"); };
    var result = List.empty<(Nat, Int)>();
    for ((id, ts) in deviceManualChaptersTrashed.entries()) { result.add((id, ts)); };
    result.toArray();
  };

  // Chunkowany upload obrazka backupu dokumentacji (surowe bajty, bez
  // base64) — beginManualImageUpload rezerwuje losowe, nieodgadnialne id
  // (jak fileId w fget-personal-drive), appendManualImageChunk dokłada
  // kolejne kawałki, commitManualImageUpload finalizuje zapis. Serwowanie
  // pod /manualImage/<id> — patrz http_request w main.mo.
  public shared ({ caller }) func beginManualImageUpload() : async Text {
    requireManualWrite(caller);
    let entropy = Blob.toArray(await Random.blob());
    let hex = "0123456789abcdef";
    let hexChars = Text.toArray(hex);
    var id = "img_";
    var i = 0;
    while (i < 32) {
      let byte = Nat8.toNat(entropy[i / 2]);
      let idx = if (i % 2 == 0) { byte / 16 } else { byte % 16 };
      id #= Text.fromChar(hexChars[idx]);
      i += 1;
    };
    deviceManualImageUploadBuffers.add(id, List.empty<Nat8>());
    id;
  };

  public shared ({ caller }) func appendManualImageChunk(id : Text, chunk : Blob) : async Bool {
    requireManualWrite(caller);
    switch (deviceManualImageUploadBuffers.get(id)) {
      case (?buf) {
        for (b in chunk.vals()) { buf.add(b); };
        true;
      };
      case null { false };
    };
  };

  public shared ({ caller }) func commitManualImageUpload(id : Text, contentType : Text) : async Bool {
    requireManualWrite(caller);
    switch (deviceManualImageUploadBuffers.get(id)) {
      case (?buf) {
        deviceManualImages.add(id, Blob.fromArray(buf.toArray()));
        deviceManualImageContentType.add(id, contentType);
        deviceManualImageUploadBuffers.remove(id);
        true;
      };
      case null { false };
    };
  };

  // Usuwanie nieużywanego już obrazka backupu (np. po nadpisaniu kopii
  // rozdziału nowszą wersją) — admin-only, symetrycznie do reszty kosza.
  public shared ({ caller }) func deleteManualImage(id : Text) : async Bool {
    requireManualWrite(caller);
    deviceManualImages.remove(id);
    deviceManualImageContentType.remove(id);
    true;
  };
};
