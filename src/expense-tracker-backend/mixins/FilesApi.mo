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
) {
  public shared ({ caller }) func createFolder(name : Text, parentId : ?Nat) : async Nat {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
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
    let key = Nat.toText(fileId) # "-" # Nat.toText(chunkIndex);
    fileChunks.get(key);
  };

  public query ({ caller }) func getFileMeta(fileId : Nat) : async ?Types.FileMeta {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    files.get(fileId);
  };

  public query ({ caller }) func listFiles() : async [Types.FileMeta] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    var result = List.empty<Types.FileMeta>();
    for ((_, f) in files.entries()) {
      result.add(f);
    };
    result.toArray();
  };

  public query ({ caller }) func listAllFolders() : async [Types.Folder] {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    var result = List.empty<Types.Folder>();
    for ((_, f) in folders.entries()) {
      result.add(f);
    };
    result.toArray();
  };

  public query ({ caller }) func listFolderContents(parentId : ?Nat) : async { folders : [Types.Folder]; files : [Types.FileMeta] } {
    if (not AccessLib.hasAnyRole(accessRoles, caller)) { Runtime.trap("Access required"); };
    var f = List.empty<Types.Folder>();
    for ((_, folder) in folders.entries()) {
      if (folder.parentId == parentId) { f.add(folder); };
    };
    var fl = List.empty<Types.FileMeta>();
    for ((_, file) in files.entries()) {
      if (file.parentId == parentId) { fl.add(file); };
    };
    { folders = f.toArray(); files = fl.toArray() };
  };

  public shared ({ caller }) func bulkMoveFiles(fileIds : [Nat], newParentId : ?Nat) : async Nat {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
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
    switch (folders.get(folderId)) {
      case (?f) {
        folders.add(folderId, { f with parentId = newParentId });
        true;
      };
      case null { false };
    };
  };

  public shared ({ caller }) func bulkDeleteFiles(fileIds : [Nat]) : async Nat {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    var count = 0;
    for (fileId in fileIds.vals()) {
      switch (files.get(fileId)) {
        case (?meta) {
          var i = 0;
          while (i < meta.totalChunks) {
            let key = Nat.toText(fileId) # "-" # Nat.toText(i);
            fileChunks.remove(key);
            i += 1;
          };
          files.remove(fileId);
          count += 1;
        };
        case null {};
      };
    };
    count;
  };

  public shared ({ caller }) func deleteFile(fileId : Nat) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
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

  public shared ({ caller }) func deleteFolder(folderId : Nat) : async Bool {
    if (not AccessLib.hasWriteAccess(accessRoles, caller)) { Runtime.trap("Write access required"); };
    switch (folders.get(folderId)) {
      case (?_) {
        folders.remove(folderId);
        true;
      };
      case null { false };
    };
  };
};
