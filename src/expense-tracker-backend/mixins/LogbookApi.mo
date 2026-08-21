import Map "mo:core/Map";
import List "mo:core/List";
import Types "../types";
import Principal "mo:core/Principal";
import Time "mo:core/Time";
import Runtime "mo:core/Runtime";
import Text "mo:core/Text";
import Blob "mo:core/Blob";
import Random "mo:core/Random";
import Nat "mo:core/Nat";
import AccessLib "../lib/access";
import InvitesLib "../lib/invites";
import Sha256 "mo:sha2/Sha256";

// Dziennik użytkowania urządzeń (FNPT II / BAS / etc.) — instruktorzy logują
// się z zewnętrznej (publicznej) strony przez 6-cyfrowy PIN + firmowy adres
// e-mail, BEZ Internet Identity. To świadomie osobny, węższy mechanizm
// autoryzacji od reszty apki (accessRoles/moduleAccess) — instruktorzy nie
// są pracownikami z kontem w systemie, tylko zewnętrznymi użytkownikami
// urządzenia. Zarządzanie instruktorami (dodawanie/reset PIN/dezaktywacja)
// oraz przegląd wpisów pozostaje za zwykłym modułem "logbook"
// (accessRoles/moduleAccess), tak jak reszta apki.
mixin (
  logbookEntries : Map.Map<Nat, Types.LogbookEntry>,
  logbookEntriesTrashed : Map.Map<Nat, Int>,
  logbookEntrySignatures : Map.Map<Nat, Text>,
  logbookEntryDeviceId : Map.Map<Nat, Nat>,
  devices : Map.Map<Nat, Types.Device>,
  logbookInstructorPinHash : Map.Map<Text, Blob>,
  logbookInstructorSalt : Map.Map<Text, Text>,
  logbookInstructorName : Map.Map<Text, Text>,
  logbookInstructorActive : Map.Map<Text, Bool>,
  logbookInstructorCreatedAt : Map.Map<Text, Int>,
  logbookSessions : Map.Map<Text, (Text, Int)>,
  logbookLoginAttempts : Map.Map<Text, (Nat, Int)>,
  recentLogbookSubmissions : List.List<Int>,
  accessRoles : Map.Map<Principal, Types.Role>,
  moduleAccess : Map.Map<Principal, [Text]>,
) {
  let ALLOWED_DOMAIN : Text = "@bartoliniair.com";
  let SESSION_TTL_NS : Int = 12 * 60 * 60 * 1_000_000_000; // 12h
  let LOCKOUT_WINDOW_NS : Int = 15 * 60 * 1_000_000_000; // 15 min
  let LOCKOUT_MAX_ATTEMPTS : Nat = 5;

  func requireLogbookAdmin(caller : Principal) {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "logbook")) { Runtime.trap("Module access required: logbook"); };
  };

  func normalizeEmail(email : Text) : Text {
    Text.toLower(Text.trim(email, #char ' '));
  };

  func isAllowedDomain(email : Text) : Bool {
    Text.endsWith(normalizeEmail(email), #text ALLOWED_DOMAIN);
  };

  func hashPin(email : Text, pin : Text, salt : Text) : Blob {
    Sha256.fromBlob(#sha256, Text.encodeUtf8(email # ":logbookPin:" # pin # ":" # salt));
  };

  func generateSalt() : async Text {
    await InvitesLib.generateRandomCode();
  };

  func invalidateSessionsFor(email : Text) {
    var toRemove = List.empty<Text>();
    for ((token, entry) in logbookSessions.entries()) {
      let (sessEmail, _) = entry;
      if (sessEmail == email) { toRemove.add(token); };
    };
    for (token in toRemove.values()) { logbookSessions.remove(token); };
  };

  func generatePin() : async Text {
    var pin = "";
    var i = 0;
    while (i < 6) {
      let digit = await Random.natRange(0, 10);
      pin := pin # Nat.toText(digit);
      i += 1;
    };
    pin;
  };

  // --- Admin: zarządzanie instruktorami (wewnętrzne role/moduleAccess) ---

  // Zwraca wygenerowany PIN w PLAINTEXT — TYLKO w tym jednym momencie
  // (odpowiedź wywołania). Nigdzie indziej PIN nie jest przechowywany ani
  // odczytywalny — canister trzyma wyłącznie hash + sól. Admin musi
  // przekazać ten PIN instruktorowi od razu (np. ustnie/SMS), bo nie da się
  // go później odzyskać, tylko zresetować.
  public shared ({ caller }) func addLogbookInstructor(email : Text, name : Text) : async Text {
    requireLogbookAdmin(caller);
    let normEmail = normalizeEmail(email);
    if (not isAllowedDomain(normEmail)) { Runtime.trap("Email must be in the " # ALLOWED_DOMAIN # " domain"); };
    if (logbookInstructorPinHash.get(normEmail) != null) { Runtime.trap("Instructor already exists"); };
    let pin = await generatePin();
    let salt = await generateSalt();
    logbookInstructorPinHash.add(normEmail, hashPin(normEmail, pin, salt));
    logbookInstructorSalt.add(normEmail, salt);
    logbookInstructorName.add(normEmail, name);
    logbookInstructorActive.add(normEmail, true);
    logbookInstructorCreatedAt.add(normEmail, Time.now());
    pin;
  };

  // Jak wyżej — nowy PIN w plaintext zwracany tylko raz, w odpowiedzi.
  public shared ({ caller }) func resetLogbookInstructorPin(email : Text) : async Text {
    requireLogbookAdmin(caller);
    let normEmail = normalizeEmail(email);
    if (logbookInstructorPinHash.get(normEmail) == null) { Runtime.trap("Instructor not found"); };
    let pin = await generatePin();
    let salt = await generateSalt();
    logbookInstructorPinHash.add(normEmail, hashPin(normEmail, pin, salt));
    logbookInstructorSalt.add(normEmail, salt);
    invalidateSessionsFor(normEmail);
    pin;
  };

  public shared ({ caller }) func setLogbookInstructorActive(email : Text, active : Bool) : async Bool {
    requireLogbookAdmin(caller);
    let normEmail = normalizeEmail(email);
    switch (logbookInstructorPinHash.get(normEmail)) {
      case (?_) {
        logbookInstructorActive.add(normEmail, active);
        if (not active) { invalidateSessionsFor(normEmail); };
        true;
      };
      case null { false };
    };
  };

  public query ({ caller }) func listLogbookInstructors() : async [Types.LogbookInstructorView] {
    requireLogbookAdmin(caller);
    var result = List.empty<Types.LogbookInstructorView>();
    for ((email, name) in logbookInstructorName.entries()) {
      let createdAt = switch (logbookInstructorCreatedAt.get(email)) { case (?t) { t }; case null { 0 } };
      result.add({
        email;
        name;
        active = logbookInstructorActive.get(email) == ?true;
        createdAt;
      });
    };
    result.toArray();
  };

  // --- Publiczne: logowanie PIN-em i zapis wpisu (bez accessRoles) ---

  func pruneAndCheckLockout(email : Text) {
    let now = Time.now();
    switch (logbookLoginAttempts.get(email)) {
      case (?(count, windowStart)) {
        if (now - windowStart > LOCKOUT_WINDOW_NS) {
          logbookLoginAttempts.remove(email);
        } else if (count >= LOCKOUT_MAX_ATTEMPTS) {
          Runtime.trap("Too many failed attempts — try again later");
        };
      };
      case null {};
    };
  };

  func recordFailedAttempt(email : Text) {
    let now = Time.now();
    switch (logbookLoginAttempts.get(email)) {
      case (?(count, windowStart)) {
        if (now - windowStart > LOCKOUT_WINDOW_NS) {
          logbookLoginAttempts.add(email, (1, now));
        } else {
          logbookLoginAttempts.add(email, (count + 1, windowStart));
        };
      };
      case null { logbookLoginAttempts.add(email, (1, now)); };
    };
  };

  func clearFailedAttempts(email : Text) {
    logbookLoginAttempts.remove(email);
  };

  public shared func loginLogbookInstructor(email : Text, pin : Text, honeypot : Text) : async ?Text {
    if (honeypot != "") { Runtime.trap("Rejected"); };
    let normEmail = normalizeEmail(email);
    if (not isAllowedDomain(normEmail)) { return null; };
    pruneAndCheckLockout(normEmail);
    switch (logbookInstructorPinHash.get(normEmail), logbookInstructorSalt.get(normEmail)) {
      case (?storedHash, ?salt) {
        if (logbookInstructorActive.get(normEmail) != ?true) { recordFailedAttempt(normEmail); return null; };
        let candidateHash = hashPin(normEmail, pin, salt);
        if (Blob.equal(candidateHash, storedHash)) {
          clearFailedAttempts(normEmail);
          let tokenPart1 = await InvitesLib.generateRandomCode();
          let tokenPart2 = await InvitesLib.generateRandomCode();
          let token = tokenPart1 # tokenPart2;
          logbookSessions.add(token, (normEmail, Time.now() + SESSION_TTL_NS));
          ?token;
        } else {
          recordFailedAttempt(normEmail);
          null;
        };
      };
      case (_, _) {
        recordFailedAttempt(normEmail);
        null;
      };
    };
  };

  func requireValidSession(sessionToken : Text) : Text {
    switch (logbookSessions.get(sessionToken)) {
      case (?(email, expiresAt)) {
        if (Time.now() > expiresAt) {
          logbookSessions.remove(sessionToken);
          Runtime.trap("Session expired — please log in again");
        };
        if (logbookInstructorActive.get(email) != ?true) { Runtime.trap("Instructor account inactive"); };
        email;
      };
      case null { Runtime.trap("Invalid session — please log in again"); };
    };
  };

  public shared func submitLogbookEntry(
    sessionToken : Text,
    deviceId : Nat,
    dataText : Text,
    instruktorNameInput : Text,
    szkoleni : Text,
    rodzajAktywnosci : Types.LogbookActivityType,
    godzRozpoczecia : Text,
    godzZakonczenia : Text,
    licznikPoSesji : Text,
    brakUsterek : Bool,
    opisUsterki : Text,
    podpisDataUrl : Text,
    honeypot : Text,
  ) : async Bool {
    if (honeypot != "") { Runtime.trap("Rejected"); };
    if (Text.size(Text.trim(podpisDataUrl, #char ' ')) == 0) { Runtime.trap("Signature required"); };
    if (Text.size(Text.trim(instruktorNameInput, #char ' ')) == 0) { Runtime.trap("Instructor name required"); };
    if (devices.get(deviceId) == null) { Runtime.trap("Unknown device"); };
    let email = requireValidSession(sessionToken);

    let now = Time.now();
    let oneMinuteAgo : Int = now - 60_000_000_000;
    var stillValid = List.empty<Int>();
    for (t in recentLogbookSubmissions.values()) {
      if (t > oneMinuteAgo) { stillValid.add(t); };
    };
    if (stillValid.size() >= 10) { Runtime.trap("Rate limit exceeded, try again later"); };
    stillValid.add(now);
    recentLogbookSubmissions.clear();
    for (t in stillValid.values()) { recentLogbookSubmissions.add(t); };

    let newId = logbookEntries.size();
    logbookEntries.add(newId, {
      id = newId;
      dataText;
      instruktorEmail = email;
      instruktorName = Text.trim(instruktorNameInput, #char ' ');
      szkoleni;
      rodzajAktywnosci;
      godzRozpoczecia;
      godzZakonczenia;
      licznikPoSesji;
      brakUsterek;
      opisUsterki;
      createdAt = now;
    });
    logbookEntrySignatures.add(newId, podpisDataUrl);
    logbookEntryDeviceId.add(newId, deviceId);
    true;
  };

  public query func logbookWhoAmI(sessionToken : Text) : async ?Text {
    switch (logbookSessions.get(sessionToken)) {
      case (?(email, expiresAt)) {
        if (Time.now() > expiresAt) { null } else { ?email };
      };
      case null { null };
    };
  };

  func requireValidSessionQuery(sessionToken : Text) : Text {
    switch (logbookSessions.get(sessionToken)) {
      case (?(email, expiresAt)) {
        if (Time.now() > expiresAt) { Runtime.trap("Session expired — please log in again"); };
        email;
      };
      case null { Runtime.trap("Invalid session — please log in again"); };
    };
  };

  public query func listDevicesForLogbook(sessionToken : Text) : async [(Nat, Text)] {
    ignore requireValidSessionQuery(sessionToken);
    var result = List.empty<(Nat, Text)>();
    for ((id, d) in devices.entries()) {
      result.add((id, d.symbol # " — " # d.name));
    };
    result.toArray();
  };

  public query func getLastLogbookCounterForDevice(sessionToken : Text, deviceId : Nat) : async ?Text {
    ignore requireValidSessionQuery(sessionToken);
    var bestId : ?Nat = null;
    for ((id, devId) in logbookEntryDeviceId.entries()) {
      if (devId == deviceId and logbookEntriesTrashed.get(id) == null) {
        switch (bestId) {
          case (?b) { if (id > b) { bestId := ?id; }; };
          case null { bestId := ?id; };
        };
      };
    };
    switch (bestId) {
      case (?id) {
        switch (logbookEntries.get(id)) {
          case (?e) { ?e.licznikPoSesji };
          case null { null };
        };
      };
      case null { null };
    };
  };

  public query func listLogbookNameSuggestions(sessionToken : Text) : async [Text] {
    ignore requireValidSessionQuery(sessionToken);
    var result = List.empty<Text>();
    for ((_, name) in logbookInstructorName.entries()) { result.add(name); };
    for ((_, e) in logbookEntries.entries()) {
      if (Text.size(e.instruktorName) > 0) { result.add(e.instruktorName); };
      for (part in Text.split(e.szkoleni, #char ',')) {
        let trimmed = Text.trim(part, #char ' ');
        if (Text.size(trimmed) > 0) { result.add(trimmed); };
      };
    };
    result.toArray();
  };

  // Historia własnych wpisów zalogowanego instruktora (sesja PIN-owa, nie
  // accessRoles) — zwraca tylko wpisy powiązane z jego adresem e-mail z
  // sesji, więc jeden instruktor nie zobaczy wpisów innych. Dołącza etykietę
  // urządzenia, żeby frontend nie musiał robić osobnego wywołania.
  public query func listMyLogbookEntries(sessionToken : Text) : async [(Types.LogbookEntry, Text)] {
    let email = requireValidSessionQuery(sessionToken);
    var result = List.empty<(Types.LogbookEntry, Text)>();
    for ((id, e) in logbookEntries.entries()) {
      if (e.instruktorEmail == email and logbookEntriesTrashed.get(id) == null) {
        let devLabel = switch (logbookEntryDeviceId.get(id)) {
          case (?devId) {
            switch (devices.get(devId)) {
              case (?d) { d.symbol # " — " # d.name };
              case null { "?" };
            };
          };
          case null { "?" };
        };
        result.add((e, devLabel));
      };
    };
    result.toArray();
  };

  // --- Admin: przegląd / kosz wpisów (spójne z resztą apki) ---

  public query ({ caller }) func listLogbookEntries() : async [Types.LogbookEntry] {
    requireLogbookAdmin(caller);
    var result = List.empty<Types.LogbookEntry>();
    for ((id, e) in logbookEntries.entries()) {
      if (logbookEntriesTrashed.get(id) == null) { result.add(e); };
    };
    result.toArray();
  };

  public query ({ caller }) func listLogbookEntrySignatures() : async [(Nat, Text)] {
    requireLogbookAdmin(caller);
    var result = List.empty<(Nat, Text)>();
    for ((id, sig) in logbookEntrySignatures.entries()) {
      result.add((id, sig));
    };
    result.toArray();
  };

  public query ({ caller }) func listLogbookEntryDevices() : async [(Nat, Nat, Text)] {
    requireLogbookAdmin(caller);
    var result = List.empty<(Nat, Nat, Text)>();
    for ((id, devId) in logbookEntryDeviceId.entries()) {
      let devLabel = switch (devices.get(devId)) {
        case (?d) { d.symbol # " — " # d.name };
        case null { "?" };
      };
      result.add((id, devId, devLabel));
    };
    result.toArray();
  };

  public shared ({ caller }) func trashLogbookEntry(id : Nat) : async Bool {
    requireLogbookAdmin(caller);
    switch (logbookEntries.get(id)) {
      case (?_) { logbookEntriesTrashed.add(id, Time.now()); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func restoreLogbookEntry(id : Nat) : async Bool {
    requireLogbookAdmin(caller);
    switch (logbookEntriesTrashed.get(id)) {
      case (?_) { logbookEntriesTrashed.remove(id); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func permanentlyDeleteLogbookEntry(id : Nat) : async Bool {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can permanently delete"); };
    logbookEntriesTrashed.remove(id);
    logbookEntries.remove(id);
    logbookEntrySignatures.remove(id);
    logbookEntryDeviceId.remove(id);
    true;
  };

  public query ({ caller }) func listTrashedLogbookEntries() : async [Types.LogbookEntry] {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Admin access required"); };
    var result = List.empty<Types.LogbookEntry>();
    for ((id, _) in logbookEntriesTrashed.entries()) {
      switch (logbookEntries.get(id)) {
        case (?e) { result.add(e); };
        case null {};
      };
    };
    result.toArray();
  };
};
