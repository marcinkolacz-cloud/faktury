import Map "mo:core/Map";
import List "mo:core/List";
import Types "../types";
import Principal "mo:core/Principal";
import Time "mo:core/Time";
import Runtime "mo:core/Runtime";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import AccessLib "../lib/access";

mixin (
  files : Map.Map<Nat, Types.FileMeta>,
  fileChunks : Map.Map<Text, Blob>,
  folders : Map.Map<Nat, Types.Folder>,
  accessRoles : Map.Map<Principal, Types.Role>,
  filesTrashed : Map.Map<Nat, Int>,
  foldersTrashed : Map.Map<Nat, Int>,
  moduleAccess : Map.Map<Principal, [Text]>,
) {
  public shared ({ caller }) func createFolder(name : Text, parentId : ?Nat) : async Nat {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "drive")) { Runtime.trap("Module access required: drive"); };
    var maxId = 0;
    var any = false;
    for ((id, _) in folders.entries()) {
      if (not any or id >= maxId) { maxId := id; any := true; };
    };
    let newId = if (any) { maxId + 1 } else { 0 };
    if (parentId == ?newId) { Runtime.trap("Invalid parent: folder cannot be its own parent"); };
    let folder : Types.Folder = {
      id = newId;
      name;
      parentId;
      createdBy = caller.toText();
      createdAt = Time.now();
    };
    folders.add(newId, folder);
    newId;
  };

  public shared ({ caller }) func createFileUpload(
    name : Text,
    contentType : Text,
    size : Nat,
    totalChunks : Nat,
    parentId : ?Nat,
  ) : async Nat {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "drive")) { Runtime.trap("Module access required: drive"); };
    var maxId = 0;
    var any = false;
    for ((id, _) in files.entries()) {
      if (not any or id >= maxId) { maxId := id; any := true; };
    };
    let newId = if (any) { maxId + 1 } else { 0 };
    let meta : Types.FileMeta = {
      id = newId;
      name;
      contentType;
      size;
      totalChunks;
      parentId;
      uploadedBy = caller.toText();
      createdAt = Time.now();
    };
    files.add(newId, meta);
    newId;
  };

  public shared ({ caller }) func uploadChunk(fileId : Nat, chunkIndex : Nat, data : Blob) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "drive")) { Runtime.trap("Module access required: drive"); };
    switch (files.get(fileId)) {
      case (?_) {
        let key = Nat.toText(fileId) # "-" # Nat.toText(chunkIndex);
        fileChunks.add(key, data);
        true;
      };
      case null { false };
    };
  };

  public query ({ caller }) func getChunk(fileId : Nat, chunkIndex : Nat) : async ?Blob {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "drive")) { Runtime.trap("Module access required: drive"); };
    let key = Nat.toText(fileId) # "-" # Nat.toText(chunkIndex);
    fileChunks.get(key);
  };

  public query ({ caller }) func getFileMeta(fileId : Nat) : async ?Types.FileMeta {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "drive")) { Runtime.trap("Module access required: drive"); };
    files.get(fileId);
  };

  public query ({ caller }) func listFiles() : async [Types.FileMeta] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "drive")) { Runtime.trap("Module access required: drive"); };
    var result = List.empty<Types.FileMeta>();
    for ((id, f) in files.entries()) {
      if (filesTrashed.get(id) == null) { result.add(f); };
    };
    result.toArray();
  };

  public query ({ caller }) func listAllFolders() : async [Types.Folder] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "drive")) { Runtime.trap("Module access required: drive"); };
    var result = List.empty<Types.Folder>();
    for ((id, f) in folders.entries()) {
      if (foldersTrashed.get(id) == null) { result.add(f); };
    };
    result.toArray();
  };

  public query ({ caller }) func listFolderContents(parentId : ?Nat) : async { folders : [Types.Folder]; files : [Types.FileMeta] } {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "drive")) { Runtime.trap("Module access required: drive"); };
    var f = List.empty<Types.Folder>();
    for ((id, folder) in folders.entries()) {
      if (folder.parentId == parentId and foldersTrashed.get(id) == null) { f.add(folder); };
    };
    var fl = List.empty<Types.FileMeta>();
    for ((id, file) in files.entries()) {
      if (file.parentId == parentId and filesTrashed.get(id) == null) { fl.add(file); };
    };
    { folders = f.toArray(); files = fl.toArray() };
  };

  public shared ({ caller }) func bulkMoveFiles(fileIds : [Nat], newParentId : ?Nat) : async Nat {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "drive")) { Runtime.trap("Module access required: drive"); };
    var count = 0;
    for (fileId in fileIds.vals()) {
      switch (files.get(fileId)) {
        case (?meta) {
          files.add(fileId, { meta with parentId = newParentId });
          count += 1;
        };
        case null {};
      };
    };
    count;
  };

  public shared ({ caller }) func moveFile(fileId : Nat, newParentId : ?Nat) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "drive")) { Runtime.trap("Module access required: drive"); };
    switch (files.get(fileId)) {
      case (?meta) {
        files.add(fileId, { meta with parentId = newParentId });
        true;
      };
      case null { false };
    };
  };

  public shared ({ caller }) func moveFolder(folderId : Nat, newParentId : ?Nat) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "drive")) { Runtime.trap("Module access required: drive"); };
    switch (folders.get(folderId)) {
      case (?f) {
        folders.add(folderId, { f with parentId = newParentId });
        true;
      };
      case null { false };
    };
  };

  // SAFETY: bulkDeleteFiles/deleteFile/bulkDeleteFolders/deleteFolder used to
  // hard-delete immediately (files.remove/folders.remove, including erasing
  // binary chunks) with no recovery path, and only required `write` access —
  // any staff member, not just an admin, could permanently destroy any file
  // or folder in one call. They now move items to trash instead; chunks are
  // only actually erased by the new admin-only permanentlyDelete* functions.
  public shared ({ caller }) func bulkDeleteFiles(fileIds : [Nat]) : async Nat {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "drive")) { Runtime.trap("Module access required: drive"); };
    var count = 0;
    for (fileId in fileIds.vals()) {
      switch (files.get(fileId)) {
        case (?_) {
          if (filesTrashed.get(fileId) == null) {
            filesTrashed.add(fileId, Time.now());
            count += 1;
          };
        };
        case null {};
      };
    };
    count;
  };

  public shared ({ caller }) func deleteFile(fileId : Nat) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "drive")) { Runtime.trap("Module access required: drive"); };
    switch (files.get(fileId)) {
      case (?_) { filesTrashed.add(fileId, Time.now()); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func bulkDeleteFolders(folderIds : [Nat]) : async Nat {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "drive")) { Runtime.trap("Module access required: drive"); };
    var count = 0;
    for (folderId in folderIds.vals()) {
      switch (folders.get(folderId)) {
        case (?_) {
          if (foldersTrashed.get(folderId) == null) {
            foldersTrashed.add(folderId, Time.now());
            count += 1;
          };
        };
        case null {};
      };
    };
    count;
  };

  public shared ({ caller }) func deleteFolder(folderId : Nat) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "drive")) { Runtime.trap("Module access required: drive"); };
    switch (folders.get(folderId)) {
      case (?_) { foldersTrashed.add(folderId, Time.now()); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func restoreFile(fileId : Nat) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "drive")) { Runtime.trap("Module access required: drive"); };
    switch (filesTrashed.get(fileId)) {
      case (?_) { filesTrashed.remove(fileId); true; };
      case null { false };
    };
  };

  public shared ({ caller }) func restoreFolder(folderId : Nat) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "drive")) { Runtime.trap("Module access required: drive"); };
    switch (foldersTrashed.get(folderId)) {
      case (?_) { foldersTrashed.remove(folderId); true; };
      case null { false };
    };
  };

  public query ({ caller }) func listTrashedFiles() : async [Types.FileMeta] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "drive")) { Runtime.trap("Module access required: drive"); };
    var result = List.empty<Types.FileMeta>();
    for ((id, _) in filesTrashed.entries()) {
      switch (files.get(id)) {
        case (?f) { result.add(f); };
        case null {};
      };
    };
    result.toArray();
  };

  public query ({ caller }) func listTrashedFolders() : async [Types.Folder] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    if (not AccessLib.hasModuleAccess(moduleAccess, caller, "drive")) { Runtime.trap("Module access required: drive"); };
    var result = List.empty<Types.Folder>();
    for ((id, _) in foldersTrashed.entries()) {
      switch (folders.get(id)) {
        case (?f) { result.add(f); };
        case null {};
      };
    };
    result.toArray();
  };

  public shared ({ caller }) func permanentlyDeleteFile(fileId : Nat) : async Bool {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can permanently delete"); };
    filesTrashed.remove(fileId);
    switch (files.get(fileId)) {
      case (?meta) {
        var i = 0;
        while (i < meta.totalChunks) {
          let key = Nat.toText(fileId) # "-" # Nat.toText(i);
          fileChunks.remove(key);
          i += 1;
        };
        files.remove(fileId);
        true;
      };
      case null { false };
    };
  };

  public shared ({ caller }) func permanentlyDeleteFolder(folderId : Nat) : async Bool {
    if (not AccessLib.isAdmin(accessRoles, caller)) { Runtime.trap("Only admin can permanently delete"); };
    foldersTrashed.remove(folderId);
    switch (folders.get(folderId)) {
      case (?_) { folders.remove(folderId); true; };
      case null { false };
    };
  };
};
