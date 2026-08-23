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
import Iter "mo:core/Iter";
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
  logbookEntryLinkedTicket : Map.Map<Nat, Nat>,
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
  tickets : Map.Map<Nat, Types.Ticket>,
  ticketTokens : Map.Map<Text, Nat>,
  ticketExtras : Map.Map<Nat, Types.TicketExtras>,
  recentSubmissionTimes : List.List<Int>,
) {
  let ALLOWED_DOMAIN : Text = "@bartoliniair.com";
  let SESSION_TTL_NS : Int = 12 * 60 * 60 * 1_000_000_000; // 12h
  let LOCKOUT_WINDOW_NS : Int = 15 * 60 * 1_000_000_000; // 15 min
  let LOCKOUT_MAX_ATTEMPTS : Nat = 5;
  let logbookPinResetTokens = Map.empty<Text, Int>(); // one-time, 5 min TTL, in-memory only

  func requireLogbookAdmin(caller : Principal) {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "logbook")) { Runtime.trap("Module access required: logbook"); };
  };

  func normalizeEmail(email : Text) : Text {
    Text.toLower(Text.trim(email, #char ' '));
  };

  // Parsuje "H:MM" lub "HH:MM" (godziny nieograniczone) na łączną liczbę
  // minut. Używane zarówno dla godzin sesji (24h), jak i licznika nalotu
  // urządzenia (nieograniczony). Zwraca null przy nieprawidłowym formacie
  // zamiast trapować — wywołujący decyduje co zrobić z brakiem wartości.
  func parseHM(s : Text) : ?Nat {
    let parts = Iter.toArray(Text.split(Text.trim(s, #char ' '), #char ':'));
    if (parts.size() != 2) { return null; };
    switch (Nat.fromText(parts[0]), Nat.fromText(parts[1])) {
      case (?h, ?m) { ?(h * 60 + m) };
      case (_, _) { null };
    };
  };

  func formatHM(totalMinutes : Nat) : Text {
    let h = totalMinutes / 60;
    let m = totalMinutes % 60;
    Nat.toText(h) # ":" # (if (m < 10) { "0" # Nat.toText(m) } else { Nat.toText(m) });
  };

  // Czas trwania sesji w minutach, licząc z zawinięciem przez północ
  // (np. rozpoczęcie 23:30, zakończenie 00:15 -> 45 minut). Nieprawidłowy
  // format godziny liczy się jako 0 minut zamiast trapować, żeby nie
  // blokować operacji administracyjnych na starych/ręcznie wpisanych danych.
  func sessionDurationMin(start : Text, end : Text) : Nat {
    switch (parseHM(start), parseHM(end)) {
      case (?s, ?e) { if (e >= s) { e - s } else { e + 24 * 60 - s } };
      case (_, _) { 0 };
    };
  };

  // Najwyższe ID wpisu spośród WSZYSTKICH (dowolne urządzenie, dowolny
  // instruktor) niewykasowanych wpisów w dzienniku — to jest "ostatni wpis"
  // w rozumieniu funkcji edycji: świadomie globalne, nie per-urządzenie i nie
  // per-instruktor, żeby zabezpieczyć łańcuch liczników przed pomyleniem.
  func maxNonTrashedLogbookId() : ?Nat {
    var maxId : ?Nat = null;
    for ((id, _) in logbookEntries.entries()) {
      if (logbookEntriesTrashed.get(id) == null) {
        switch (maxId) {
          case (?m) { if (id > m) { maxId := ?id; }; };
          case null { maxId := ?id; };
        };
      };
    };
    maxId;
  };

  // Wpis jest edytowalny przez instruktora TYLKO gdy: należy do niego (po
  // adresie e-mail z sesji) ORAZ jest globalnie ostatnim niewykasowanym
  // wpisem w całym dzienniku (patrz maxNonTrashedLogbookId). Jeśli
  // ktokolwiek — na dowolnym urządzeniu — doda nowy wpis później, stary
  // wpis przestaje być edytowalny, żeby nie rozjechać liczników.
  func isEditableByOwner(email : Text, id : Nat) : Bool {
    switch (logbookEntries.get(id)) {
      case (?e) {
        if (e.instruktorEmail != email) { false } else if (logbookEntriesTrashed.get(id) != null) { false } else {
          switch (maxNonTrashedLogbookId()) {
            case (?m) { id == m };
            case null { false };
          };
        };
      };
      case null { false };
    };
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

  // Publiczne "Nie pamiętam PIN-u" — TYLKO dla już zarejestrowanych i
  // aktywnych instruktorów (email musi już istnieć w bazie, dodany przez
  // admina). Generuje nowy PIN (nadpisuje stary) i zwraca (PIN, token) do
  // jednorazowego wysłania maila przez Worker — token konsumowany przez
  // consumeLogbookPinResetToken (server-to-server), więc przechwycony
  // token nic więcej nie zdziała. Ten sam rate-limit/lockout co logowanie.
  public shared func requestLogbookPinReset(email : Text, honeypot : Text) : async ?(Text, Text) {
    if (honeypot != "") { Runtime.trap("Rejected"); };
    let normEmail = normalizeEmail(email);
    pruneAndCheckLockout(normEmail);
    switch (logbookInstructorName.get(normEmail), logbookInstructorActive.get(normEmail)) {
      case (?_, ?true) {
        let pin = await generatePin();
        let salt = await generateSalt();
        logbookInstructorPinHash.add(normEmail, hashPin(normEmail, pin, salt));
        logbookInstructorSalt.add(normEmail, salt);
        invalidateSessionsFor(normEmail);
        let tokenPart1 = await InvitesLib.generateRandomCode();
        let tokenPart2 = await InvitesLib.generateRandomCode();
        let token = tokenPart1 # tokenPart2;
        logbookPinResetTokens.add(token, Time.now() + 300_000_000_000);
        ?(pin, token);
      };
      case (_, _) { recordFailedAttempt(normEmail); null };
    };
  };

  public shared func consumeLogbookPinResetToken(token : Text) : async Bool {
    switch (logbookPinResetTokens.get(token)) {
      case (?exp) { logbookPinResetTokens.remove(token); Time.now() < exp; };
      case null { false };
    };
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
    if (devices.get(deviceId) == null) { Runtime.trap("Unknown device"); };
    let email = requireValidSession(sessionToken);
    // Ignorujemy dowolny tekst przysłany przez klienta (instruktorNameInput)
    // i wymuszamy imię/nazwisko zarejestrowane dla tego adresu e-mail w
    // panelu Instruktorzy — inaczej jeden zalogowany instruktor mógłby
    // wpisać sesję jako ktoś inny. Frontend i tak blokuje to pole, ale
    // walidacja musi żyć tu, na serwerze.
    let resolvedName = switch (logbookInstructorName.get(email)) {
      case (?n) { n };
      case null { Text.trim(instruktorNameInput, #char ' ') };
    };
    if (Text.size(resolvedName) == 0) { Runtime.trap("Instructor name required"); };

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
      instruktorName = resolvedName;
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

  // Edycja WŁASNEGO wpisu — dozwolona tylko gdy to globalnie ostatni
  // niewykasowany wpis w całym dzienniku (patrz isEditableByOwner). Nie
  // pozwala zmienić urządzenia, e-maila instruktora ani podpisu — tylko
  // dane samej sesji. Serwer re-weryfikuje warunek edytowalności niezależnie
  // od tego, co pokazywał frontend (nie ufa samej fladze z listMyLogbookEntries).
  public shared func updateMyLogbookEntry(
    sessionToken : Text,
    entryId : Nat,
    dataText : Text,
    szkoleni : Text,
    rodzajAktywnosci : Types.LogbookActivityType,
    godzRozpoczecia : Text,
    godzZakonczenia : Text,
    licznikPoSesji : Text,
    brakUsterek : Bool,
    opisUsterki : Text,
  ) : async Bool {
    let email = requireValidSession(sessionToken);
    if (not isEditableByOwner(email, entryId)) {
      Runtime.trap("Ten wpis nie jest już edytowalny — ktoś dodał nowszy wpis w dzienniku.");
    };
    switch (logbookEntries.get(entryId)) {
      case (?e) {
        logbookEntries.add(entryId, { e with dataText; szkoleni; rodzajAktywnosci; godzRozpoczecia; godzZakonczenia; licznikPoSesji; brakUsterek; opisUsterki });
        true;
      };
      case null { false };
    };
  };

  // Instruktor zgłasza korektę wpisu, którego już nie może sam edytować
  // (bo nie jest już globalnie ostatni) — tworzy zwykły ticket (widoczny w
  // module Zgłoszenia) i zapamiętuje powiązanie z wpisem, żeby admin widział
  // od razu który wpis dotyczy zgłoszenia.
  public shared func submitLogbookCorrectionTicket(sessionToken : Text, entryId : Nat, description : Text, honeypot : Text) : async ?Text {
    if (honeypot != "") { Runtime.trap("Rejected"); };
    let email = requireValidSession(sessionToken);
    switch (logbookEntries.get(entryId)) {
      case (?e) {
        if (e.instruktorEmail != email) { Runtime.trap("To nie jest Twój wpis"); };
        let devLabel = switch (logbookEntryDeviceId.get(entryId)) {
          case (?devId) { switch (devices.get(devId)) { case (?d) { d.symbol # " — " # d.name }; case null { "" } } };
          case null { "" };
        };
        let now = Time.now();
        let oneMinuteAgo : Int = now - 60_000_000_000;
        var stillValid = List.empty<Int>();
        for (t in recentSubmissionTimes.values()) { if (t > oneMinuteAgo) { stillValid.add(t); }; };
        if (stillValid.size() >= 5) { Runtime.trap("Rate limit exceeded, try again later"); };
        stillValid.add(now);
        recentSubmissionTimes.clear();
        for (t in stillValid.values()) { recentSubmissionTimes.add(t); };

        let newId = tickets.size();
        let tokenPart1 = await InvitesLib.generateRandomCode();
        let tokenPart2 = await InvitesLib.generateRandomCode();
        let trackingToken = tokenPart1 # tokenPart2;
        let ticket : Types.Ticket = {
          id = newId;
          clientName = e.instruktorName;
          clientEmail = email;
          subject = "Korekta wpisu w dzienniku — " # devLabel # " — " # e.dataText;
          description;
          status = #open_;
          replies = [];
          createdAt = now;
        };
        tickets.add(newId, ticket);
        ticketTokens.add(trackingToken, newId);
        ticketExtras.add(newId, { company = "Bartolini Air Simulation"; deviceNumber = devLabel });
        logbookEntryLinkedTicket.add(entryId, newId);
        ?trackingToken;
      };
      case null { null };
    };
  };

  public query func logbookWhoAmI(sessionToken : Text) : async ?Text {
    switch (logbookSessions.get(sessionToken)) {
      case (?(email, expiresAt)) {
        if (Time.now() > expiresAt) { null } else { ?email };
      };
      case null { null };
    };
  };

  // Imię i nazwisko przypisane do zalogowanego instruktora (z rejestru
  // instruktorów, ustawione przez admina przy dodawaniu konta) — używane do
  // zablokowania pola "Instruktor / użytkownik" w formularzu, żeby jeden
  // instruktor nie mógł wpisać wpisu jako ktoś inny.
  public shared func logbookMyName(sessionToken : Text) : async ?Text {
    switch (logbookSessions.get(sessionToken)) {
      case (?(email, expiresAt)) {
        if (Time.now() > expiresAt) { null } else { logbookInstructorName.get(email) };
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
        // Skip entries with an empty/unset counter (e.g. an old test entry
        // filled in before the device's flightHours were known) — they're
        // not usable as a baseline, so look further back instead of
        // silently returning nothing.
        let hasUsableCounter = switch (logbookEntries.get(id)) {
          case (?e) { Text.size(Text.trim(e.licznikPoSesji, #char ' ')) > 0 };
          case null { false };
        };
        if (hasUsableCounter) {
          switch (bestId) {
            case (?b) { if (id > b) { bestId := ?id; }; };
            case null { bestId := ?id; };
          };
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
      case null {
        // Brak wcześniejszych wpisów z użytecznym licznikiem — użyj
        // liczników "flightHours"/"flightMinutes" z karty urządzenia (Moduł
        // Urządzenia) jako liczbę bazową, żeby nie zaczynać od zera dla
        // sprzętu, który już wcześniej latał.
        switch (devices.get(deviceId)) {
          case (?d) {
            if (d.flightHours == 0 and d.flightMinutes == 0) { null } else {
              ?(Nat.toText(d.flightHours) # ":" # (if (d.flightMinutes < 10) { "0" # Nat.toText(d.flightMinutes) } else { Nat.toText(d.flightMinutes) }));
            };
          };
          case null { null };
        };
      };
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
  public shared func listMyLogbookEntries(sessionToken : Text) : async [(Types.LogbookEntry, Text, Bool, ?Nat)] {
    let email = requireValidSessionQuery(sessionToken);
    var result = List.empty<(Types.LogbookEntry, Text, Bool, ?Nat)>();
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
        result.add((e, devLabel, isEditableByOwner(email, id), logbookEntryLinkedTicket.get(id)));
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

  // Admin może poprawić DOWOLNY wpis (nie tylko ostatni) — np. po zgłoszeniu
  // przez ticket. Nie przelicza sam licznika kolejnych wpisów — do tego
  // służy osobno adminRecomputeLogbookCounters, wywoływane świadomie po
  // poprawce, żeby nie nadpisywać liczników niepotrzebnie przy zwykłej
  // literówce w opisie usterki.
  public shared ({ caller }) func adminUpdateLogbookEntry(
    entryId : Nat,
    dataText : Text,
    instruktorName : Text,
    szkoleni : Text,
    rodzajAktywnosci : Types.LogbookActivityType,
    godzRozpoczecia : Text,
    godzZakonczenia : Text,
    licznikPoSesji : Text,
    brakUsterek : Bool,
    opisUsterki : Text,
  ) : async Bool {
    requireLogbookAdmin(caller);
    switch (logbookEntries.get(entryId)) {
      case (?e) {
        logbookEntries.add(entryId, { e with dataText; instruktorName; szkoleni; rodzajAktywnosci; godzRozpoczecia; godzZakonczenia; licznikPoSesji; brakUsterek; opisUsterki });
        true;
      };
      case null { false };
    };
  };

  public query ({ caller }) func getLogbookEntryLinkedTicket(entryId : Nat) : async ?Nat {
    requireLogbookAdmin(caller);
    logbookEntryLinkedTicket.get(entryId);
  };

  public query ({ caller }) func listLogbookEntryLinkedTickets() : async [(Nat, Nat)] {
    requireLogbookAdmin(caller);
    var result = List.empty<(Nat, Nat)>();
    for ((entryId, ticketId) in logbookEntryLinkedTicket.entries()) { result.add((entryId, ticketId)); };
    result.toArray();
  };

  // Po ręcznej poprawce godzin/daty wpisu przez admina licznik nalotu
  // urządzenia mógł się rozjechać dla WSZYSTKICH kolejnych wpisów tego
  // samego urządzenia (bo każdy dolicza czas swojej sesji do licznika
  // poprzedniego wpisu). Ta funkcja przelicza licznik od fromEntryId
  // (włącznie) w górę, w kolejności ID, bazując na liczniku ostatniego
  // wcześniejszego wpisu tego urządzenia (albo na "flightHours"/"flightMinutes"
  // z karty urządzenia, jeśli wcześniejszych wpisów brak). Zwraca liczbę
  // przeliczonych wpisów.
  public shared ({ caller }) func adminRecomputeLogbookCounters(deviceId : Nat, fromEntryId : Nat) : async Nat {
    requireLogbookAdmin(caller);
    var baseline : Nat = 0;
    var bestBeforeId : ?Nat = null;
    var scanId = 0;
    while (scanId < fromEntryId) {
      switch (logbookEntryDeviceId.get(scanId)) {
        case (?devId) {
          if (devId == deviceId and logbookEntriesTrashed.get(scanId) == null) {
            switch (logbookEntries.get(scanId)) {
              case (?e) {
                if (Text.size(Text.trim(e.licznikPoSesji, #char ' ')) > 0) { bestBeforeId := ?scanId; };
              };
              case null {};
            };
          };
        };
        case null {};
      };
      scanId += 1;
    };
    switch (bestBeforeId) {
      case (?bid) {
        switch (logbookEntries.get(bid)) {
          case (?e) { switch (parseHM(e.licznikPoSesji)) { case (?m) { baseline := m }; case null {} }; };
          case null {};
        };
      };
      case null {
        switch (devices.get(deviceId)) {
          case (?d) { baseline := d.flightHours * 60 + d.flightMinutes; };
          case null {};
        };
      };
    };
    var count = 0;
    var running = baseline;
    let total = logbookEntries.size();
    var id = fromEntryId;
    while (id < total) {
      switch (logbookEntryDeviceId.get(id)) {
        case (?devId) {
          if (devId == deviceId and logbookEntriesTrashed.get(id) == null) {
            switch (logbookEntries.get(id)) {
              case (?e) {
                running += sessionDurationMin(e.godzRozpoczecia, e.godzZakonczenia);
                logbookEntries.add(id, { e with licznikPoSesji = formatHM(running) });
                count += 1;
              };
              case null {};
            };
          };
        };
        case null {};
      };
      id += 1;
    };
    count;
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
