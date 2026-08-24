import Map "mo:core/Map";
import List "mo:core/List";
import Types "../types";
import Principal "mo:core/Principal";
import Time "mo:core/Time";
import Runtime "mo:core/Runtime";
import Nat "mo:core/Nat";
import AccessLib "../lib/access";

mixin (
  devices : Map.Map<Nat, Types.Device>,
  devicesTrashed : Map.Map<Nat, Int>,
  deviceServiceEntriesV2 : Map.Map<Nat, Types.DeviceServiceEntryV2>,
  accessRoles : Map.Map<Principal, Types.Role>,
  moduleAccess : Map.Map<Principal, [Text]>,
) {
  func requireDevicesAccess(caller : Principal) {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "devices")) { Runtime.trap("Module access required: devices"); };
  };

  func requireDevicesRead(caller : Principal) {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "devices")) { Runtime.trap("Module access required: devices"); };
  };

  public shared ({ caller }) func addDevice(
    symbol : Text,
    name : Text,
    client : Text,
    location : Text,
    notes : Text,
    purchaseDate : Text,
    warrantyDate : Text,
    supportPackage : Text,
    contactPerson : Text,
    flightHours : Nat,
    flightMinutes : Nat,
  ) : async Nat {
    requireDevicesAccess(caller);
    var maxId = 0;
    var any = false;
    for ((id, _) in devices.entries()) {
      if (not any or id >= maxId) { maxId := id; any := true; };
    };
    let newId = if (any) { maxId + 1 } else { 0 };
    let d : Types.Device = {
      id = newId; symbol; name; client; location; notes;
      purchaseDate; warrantyDate; supportPackage; contactPerson;
      flightHours; flightMinutes; createdBy = ""; createdAt = Time.now();
    };
    devices.add(newId, d);
    newId;
  };

  public shared ({ caller }) func updateDevice(
    id : Nat,
    symbol : Text,
    name : Text,
    client : Text,
    location : Text,
    notes : Text,
    purchaseDate : Text,
    warrantyDate : Text,
    supportPackage : Text,
    contactPerson : Text,
    flightHours : Nat,
    flightMinutes : Nat,
  ) : async Bool {
    requireDevicesAccess(caller);
    switch (devices.get(id)) {
      case (?d) {
        devices.add(id, {
          d with symbol; name; client; location; notes;
          purchaseDate; warrantyDate; supportPackage; contactPerson;
          flightHours; flightMinutes;
        });
        true;
      };
      case null { false };
    };
  };

  public query ({ caller }) func listDevices() : async [Types.Device] {
    requireDevicesRead(caller);
    var result = List.empty<Types.Device>();
    for ((id, d) in devices.entries()) {
      if (devicesTrashed.get(id) == null) { result.add(d); };
    };
    result.toArray();
  };

  public shared ({ caller }) func trashDevice(id : Nat) : async Bool {
    requireDevicesAccess(caller);
    switch (devices.get(id)) {
      case (?_) { devicesTrashed.add(id, Time.now()); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func restoreDevice(id : Nat) : async Bool {
    requireDevicesAccess(caller);
    switch (devicesTrashed.get(id)) {
      case (?_) { devicesTrashed.remove(id); true; };
      case null { false };
    };
  };

  public query ({ caller }) func listTrashedDevices() : async [Types.Device] {
    requireDevicesRead(caller);
    var result = List.empty<Types.Device>();
    for ((id, _) in devicesTrashed.entries()) {
      switch (devices.get(id)) {
        case (?d) { result.add(d); };
        case null {};
      };
    };
    result.toArray();
  };

  // Manual service log — entered independently of the ticket system,
  // e.g. routine maintenance not tied to a client-submitted ticket.
  public shared ({ caller }) func addDeviceServiceEntry(deviceId : Nat, date : Text, description : Text, performedBy : Text, flightHours : Nat, flightMinutes : Nat) : async Nat {
    requireDevicesAccess(caller);
    var maxId = 0;
    var any = false;
    for ((id, _) in deviceServiceEntriesV2.entries()) {
      if (not any or id >= maxId) { maxId := id; any := true; };
    };
    let newId = if (any) { maxId + 1 } else { 0 };
    let entry : Types.DeviceServiceEntryV2 = { id = newId; deviceId; date; description; performedBy; flightHours; flightMinutes; createdAt = Time.now() };
    deviceServiceEntriesV2.add(newId, entry);
    // Keep the device's headline "total time flight" in sync with the latest
    // manually-recorded reading, since each service entry logs the meter
    // state at that visit.
    switch (devices.get(deviceId)) {
      case (?d) { devices.add(deviceId, { d with flightHours; flightMinutes }); };
      case null {};
    };
    newId;
  };

  public shared ({ caller }) func removeDeviceServiceEntry(id : Nat) : async Bool {
    requireDevicesAccess(caller);
    switch (deviceServiceEntriesV2.get(id)) {
      case (?_) { deviceServiceEntriesV2.remove(id); true; };
      case null { false };
    };
  };

  public query ({ caller }) func listDeviceServiceEntries(deviceId : Nat) : async [Types.DeviceServiceEntryV2] {
    requireDevicesRead(caller);
    var result = List.empty<Types.DeviceServiceEntryV2>();
    for ((_, e) in deviceServiceEntriesV2.entries()) {
      if (e.deviceId == deviceId) { result.add(e); };
    };
    result.toArray();
  };

  public shared ({ caller }) func importDevices(rows : [Types.Device], overwrite : Bool) : async Nat {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can import data"); };
    var count = 0;
    for (d in rows.vals()) {
      switch (devices.get(d.id)) {
        case (?_) { if (overwrite) { devices.add(d.id, d); count += 1; }; };
        case null { devices.add(d.id, d); count += 1; };
      };
    };
    count;
  };

  public shared ({ caller }) func importDeviceServiceEntries(rows : [Types.DeviceServiceEntryV2], overwrite : Bool) : async Nat {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can import data"); };
    var count = 0;
    for (e in rows.vals()) {
      switch (deviceServiceEntriesV2.get(e.id)) {
        case (?_) { if (overwrite) { deviceServiceEntriesV2.add(e.id, e); count += 1; }; };
        case null { deviceServiceEntriesV2.add(e.id, e); count += 1; };
      };
    };
    count;
  };
};
