import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from "@capacitor-community/sqlite";

const CAPFS_PREFIX = "capfs:";

export type PhotoItem = {
  src: string;
  remark?: string;
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
  capturedAt?: string | null;
  uploaded?: boolean;
  uploadedRemark?: string;
};

export function normalizePhotoEntry(entry: unknown): PhotoItem | null {
  if (typeof entry === "string") {
    const src = entry.trim();
    return src ? { src } : null;
  }
  if (entry && typeof entry === "object") {
    const obj = entry as Record<string, unknown>;
    const src = String(obj.src ?? "").trim();
    if (!src) return null;
    const lat = typeof obj.latitude === "number" && Number.isFinite(obj.latitude) ? obj.latitude : null;
    const lon = typeof obj.longitude === "number" && Number.isFinite(obj.longitude) ? obj.longitude : null;
    const acc = typeof obj.accuracy === "number" && Number.isFinite(obj.accuracy) ? obj.accuracy : null;
    return {
      src,
      remark: obj.remark != null ? String(obj.remark) : "",
      latitude: lat,
      longitude: lon,
      accuracy: acc,
      capturedAt: obj.capturedAt != null ? String(obj.capturedAt) : null,
      uploaded: obj.uploaded === true,
      uploadedRemark: obj.uploadedRemark != null ? String(obj.uploadedRemark) : undefined,
    };
  }
  return null;
}

function photoDigest(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ ch, 2246822507) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}_${input.length}`;
}

async function persistPhotosToFilesystem(photos: Array<PhotoItem | string>, scopeId: string): Promise<PhotoItem[]> {
  const normalized = (photos ?? []).map(normalizePhotoEntry).filter((p): p is PhotoItem => p !== null);
  if (!Capacitor.isNativePlatform()) return normalized;
  const out: PhotoItem[] = [];
  for (const item of normalized) {
    let nextSrc = item.src;
    if (!nextSrc.startsWith(CAPFS_PREFIX) && nextSrc.startsWith("data:image/")) {
      const commaIndex = nextSrc.indexOf(",");
      const base64Data = commaIndex >= 0 ? nextSrc.slice(commaIndex + 1) : nextSrc;
      const relPath = `audit_photos/${scopeId}_${photoDigest(base64Data)}.jpg`;
      try {
        await Filesystem.writeFile({
          path: relPath,
          data: base64Data,
          directory: Directory.Data,
          recursive: true,
        });
        nextSrc = `${CAPFS_PREFIX}${relPath}`;
      } catch (err) {
        console.warn("[Solar Audit] Filesystem photo write fallback to inline:", err);
      }
    }
    out.push({ ...item, src: nextSrc });
  }
  return out;
}

export async function resolvePhotoRef(entry: string): Promise<string> {
  if (!entry) return "";
  if (!Capacitor.isNativePlatform() || !entry.startsWith(CAPFS_PREFIX)) {
    return entry;
  }
  const relPath = entry.slice(CAPFS_PREFIX.length);
  const file = await Filesystem.readFile({
    path: relPath,
    directory: Directory.Data,
  });
  const dataStr = typeof file.data === "string" ? file.data : "";
  if (!dataStr) return "";
  return dataStr.startsWith("data:image/") ? dataStr : `data:image/jpeg;base64,${dataStr}`;
}

async function resolvePhotosFromFilesystem(rawJson: unknown): Promise<PhotoItem[]> {
  let parsed: PhotoItem[] = [];
  try {
    const val = JSON.parse(String(rawJson ?? "[]"));
    if (Array.isArray(val)) {
      parsed = val.map(normalizePhotoEntry).filter((p): p is PhotoItem => p !== null);
    }
  } catch {
    return [];
  }
  if (!Capacitor.isNativePlatform()) return parsed;
  const resolved: PhotoItem[] = [];
  for (const entry of parsed) {
    if (entry.src.startsWith(CAPFS_PREFIX)) {
      try {
        const img = await resolvePhotoRef(entry.src);
        if (img) resolved.push({ ...entry, src: img });
      } catch (err) {
        console.warn("[Solar Audit] Could not read stored photo file:", entry.src, err);
      }
    } else {
      resolved.push(entry);
    }
  }
  return resolved;
}

const LEGACY_KEY = "solar-audit-workspace-v1";
const DB_NAME = "solar_audit_mobile";
const sqlite = new SQLiteConnection(CapacitorSQLite);

let dbPromise: Promise<SQLiteDBConnection | null> | null = null;

export type LocalPlant = {
  id: string;
  name: string;
  location: string;
  capacityMw: string;
  equipment?: { id: string; name: string; category: string }[];
  serverPlantId?: string;
  source?: "local" | "server";
};

export type AssignedUserScope = {
  id: string;
  username: string;
  fullName?: string;
  role?: string;
  siteId?: string;
  assignedServerPlantIds?: string[];
};

export type LocalWorkspace = {
  organizationName: string;
  siteName: string;
  siteLocation: string;
  plants: LocalPlant[];
  assignedUser?: AssignedUserScope;
};

function readLegacyWorkspace(): LocalWorkspace | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as LocalWorkspace;
    if (!value || typeof value !== "object" || !Array.isArray(value.plants)) return null;
    return {
      organizationName: String(value.organizationName ?? ""),
      siteName: String(value.siteName ?? ""),
      siteLocation: String(value.siteLocation ?? ""),
      plants: value.plants.map((p) => ({
        id: String(p.id ?? crypto.randomUUID()),
        name: String(p.name ?? ""),
        location: String(p.location ?? ""),
        capacityMw: String(p.capacityMw ?? ""),
        equipment: Array.isArray(p.equipment) ? p.equipment.map((item: any) => ({ id: String(item.id ?? crypto.randomUUID()), name: String(item.name ?? ""), category: String(item.category ?? "Other / Custom") })) : [],
      })),
    };
  } catch {
    return null;
  }
}

async function openDatabase(): Promise<SQLiteDBConnection | null> {
  if (!Capacitor.isNativePlatform()) return null;

  try {
    const consistency = await sqlite.checkConnectionsConsistency();
    const isConn = (await sqlite.isConnection(DB_NAME, false)).result;
    const connection = consistency.result && isConn
      ? await sqlite.retrieveConnection(DB_NAME, false)
      : await sqlite.createConnection(DB_NAME, false, "no-encryption", 1, false);

    await connection.open();
    await connection.execute(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sites (
        id TEXT PRIMARY KEY NOT NULL,
        organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        location TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS plants (
        id TEXT PRIMARY KEY NOT NULL,
        site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        location TEXT NOT NULL DEFAULT '',
        capacity_mw TEXT NOT NULL DEFAULT '',
        equipment_json TEXT NOT NULL DEFAULT '[]',
        server_plant_id TEXT,
        source TEXT NOT NULL DEFAULT 'local',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audits (
        id TEXT PRIMARY KEY NOT NULL,
        site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        plant_id TEXT REFERENCES plants(id) ON DELETE SET NULL,
        audit_type TEXT NOT NULL CHECK (audit_type IN ('Technical','Safety','Civil')),
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_equipment (
        id TEXT PRIMARY KEY NOT NULL,
        audit_id TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        equipment_type TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_checkpoints (
        id TEXT PRIMARY KEY NOT NULL,
        audit_id TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
        equipment_id TEXT REFERENCES audit_equipment(id) ON DELETE CASCADE,
        checkpoint_text TEXT NOT NULL,
        result TEXT NOT NULL DEFAULT 'NA' CHECK (result IN ('C','NC','NA','OFI')),
        remarks TEXT NOT NULL DEFAULT '',
        photos_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS observations (
        id TEXT PRIMARY KEY NOT NULL,
        audit_id TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
        checkpoint_id TEXT REFERENCES audit_checkpoints(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        finding_type TEXT NOT NULL DEFAULT 'NC',
        severity TEXT NOT NULL DEFAULT 'Minor',
        responsible_person TEXT NOT NULL DEFAULT '',
        action_text TEXT NOT NULL DEFAULT '',
        action_photos_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'open',
        target_date TEXT,
        closure_date TEXT,
        server_observation_id TEXT,
        sync_status TEXT NOT NULL DEFAULT 'local',
        sync_error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_photos (
        id TEXT PRIMARY KEY NOT NULL,
        audit_id TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
        observation_id TEXT REFERENCES observations(id) ON DELETE CASCADE,
        local_uri TEXT NOT NULL,
        file_name TEXT NOT NULL DEFAULT '',
        mime_type TEXT NOT NULL DEFAULT 'image/jpeg',
        size_bytes INTEGER NOT NULL DEFAULT 0,
        sync_status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sync_queue (
        id TEXT PRIMARY KEY NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_meta (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );
    `);

    const plantColumns = await connection.query("PRAGMA table_info(plants)");
    const existingPlantColumns = new Set((plantColumns.values ?? []).map((row) => String(row.name)));
    if (!existingPlantColumns.has("equipment_json")) {
      await connection.execute("ALTER TABLE plants ADD COLUMN equipment_json TEXT NOT NULL DEFAULT '[]'");
    }

    const plantColumnsAfterCreate = await connection.query("PRAGMA table_info(plants)");
    const plantColumnNames = new Set((plantColumnsAfterCreate.values ?? []).map((row) => String(row.name)));
    if (!plantColumnNames.has("server_plant_id")) await connection.execute("ALTER TABLE plants ADD COLUMN server_plant_id TEXT");
    if (!plantColumnNames.has("source")) await connection.execute("ALTER TABLE plants ADD COLUMN source TEXT NOT NULL DEFAULT 'local'");

    const auditColumns = await connection.query("PRAGMA table_info(audits)");
    const existingAuditColumns = new Set((auditColumns.values ?? []).map((row) => String(row.name)));
    if (!existingAuditColumns.has("auditor")) {
      await connection.execute("ALTER TABLE audits ADD COLUMN auditor TEXT NOT NULL DEFAULT ''");
    }
    if (!existingAuditColumns.has("audit_date")) {
      await connection.execute("ALTER TABLE audits ADD COLUMN audit_date TEXT NOT NULL DEFAULT ''");
    }
    const observationColumns = await connection.query("PRAGMA table_info(observations)");
    const existingObservationColumns = new Set((observationColumns.values ?? []).map((row) => String(row.name)));
    if (!existingObservationColumns.has("finding_type")) await connection.execute("ALTER TABLE observations ADD COLUMN finding_type TEXT NOT NULL DEFAULT 'NC'");
    if (!existingObservationColumns.has("responsible_person")) await connection.execute("ALTER TABLE observations ADD COLUMN responsible_person TEXT NOT NULL DEFAULT ''");
    if (!existingObservationColumns.has("action_text")) await connection.execute("ALTER TABLE observations ADD COLUMN action_text TEXT NOT NULL DEFAULT ''");
    if (!existingObservationColumns.has("action_photos_json")) await connection.execute("ALTER TABLE observations ADD COLUMN action_photos_json TEXT NOT NULL DEFAULT '[]'");
    if (!existingObservationColumns.has("target_date")) await connection.execute("ALTER TABLE observations ADD COLUMN target_date TEXT");
    if (!existingObservationColumns.has("server_observation_id")) await connection.execute("ALTER TABLE observations ADD COLUMN server_observation_id TEXT");
    if (!existingObservationColumns.has("sync_status")) await connection.execute("ALTER TABLE observations ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'local'");
    if (!existingObservationColumns.has("sync_error")) await connection.execute("ALTER TABLE observations ADD COLUMN sync_error TEXT NOT NULL DEFAULT ''");

    await migrateLegacyWorkspace(connection);
    const checkpointColumns = await connection.query("PRAGMA table_info(audit_checkpoints)");
    const existingCheckpointColumns = new Set((checkpointColumns.values ?? []).map((row) => String(row.name)));
    if (!existingCheckpointColumns.has("photos_json")) {
      await connection.execute("ALTER TABLE audit_checkpoints ADD COLUMN photos_json TEXT NOT NULL DEFAULT '[]'");
    }

    // Migrate older checkpoint tables whose CHECK constraint only allowed C/NC/NA.
    // Keep all existing checkpoint records and preserve the observations FK target.
    const checkpointSchema = await connection.query(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'audit_checkpoints'",
    );
    const checkpointSql = String(checkpointSchema.values?.[0]?.sql ?? "");
    if (checkpointSql.includes("'C','NC','NA'") || checkpointSql.includes("'C', 'NC', 'NA'")) {
      await connection.execute("PRAGMA foreign_keys = OFF;");
      await connection.execute(`
        CREATE TABLE audit_checkpoints_new (
          id TEXT PRIMARY KEY NOT NULL,
          audit_id TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
          equipment_id TEXT REFERENCES audit_equipment(id) ON DELETE CASCADE,
          checkpoint_text TEXT NOT NULL,
          result TEXT NOT NULL DEFAULT 'NA' CHECK (result IN ('C','NC','NA','OFI')),
          remarks TEXT NOT NULL DEFAULT '',
          photos_json TEXT NOT NULL DEFAULT '[]',
          updated_at TEXT NOT NULL
        );
        INSERT INTO audit_checkpoints_new (id, audit_id, equipment_id, checkpoint_text, result, remarks, photos_json, updated_at)
          SELECT id, audit_id, equipment_id, checkpoint_text, result, remarks, COALESCE(photos_json, '[]'), updated_at
          FROM audit_checkpoints;
        DROP TABLE audit_checkpoints;
        ALTER TABLE audit_checkpoints_new RENAME TO audit_checkpoints;
      `);
      await connection.execute("PRAGMA foreign_keys = ON;");
    }

    // Heal any observations whose checkpoint_id was nulled by an earlier schema migration,
    // and deduplicate rows that share the same server_observation_id.
    await connection.execute(`
      UPDATE observations
      SET checkpoint_id = (
        SELECT c.id FROM audit_checkpoints c
        WHERE c.audit_id = observations.audit_id
          AND LOWER(TRIM(c.checkpoint_text)) = LOWER(TRIM(observations.title))
        LIMIT 1
      )
      WHERE checkpoint_id IS NULL;
      DELETE FROM observations
      WHERE server_observation_id IS NOT NULL
        AND id NOT IN (
          SELECT o1.id FROM observations o1
          WHERE o1.server_observation_id = observations.server_observation_id
          ORDER BY o1.updated_at DESC, o1.rowid DESC
          LIMIT 1
        );
    `);

    return connection;
  } catch (error) {
    console.error("[Solar Audit] SQLite initialization failed:", error);
    throw error;
  }
}

async function migrateLegacyWorkspace(connection: SQLiteDBConnection): Promise<void> {
  const marker = await connection.query("SELECT value FROM app_meta WHERE key = 'legacy_workspace_migrated'");
  if (marker.values?.length) return;

  const legacy = readLegacyWorkspace();
  if (legacy) {
    const existing = await connection.query("SELECT id FROM organizations LIMIT 1");
    if (!existing.values?.length && legacy.organizationName.trim() && legacy.siteName.trim()) {
      const now = new Date().toISOString();
      const orgId = crypto.randomUUID();
      const siteId = crypto.randomUUID();

      await connection.run(
        "INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)",
        [orgId, legacy.organizationName.trim(), now],
      );
      await connection.run(
        "INSERT INTO sites (id, organization_id, name, location, created_at) VALUES (?, ?, ?, ?, ?)",
        [siteId, orgId, legacy.siteName.trim(), legacy.siteLocation.trim(), now],
      );

      for (const plant of legacy.plants) {
        await connection.run(
          "INSERT OR IGNORE INTO plants (id, site_id, name, location, capacity_mw, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          [plant.id, siteId, plant.name, plant.location, plant.capacityMw, now],
        );
      }
    }
  }

  await connection.run(
    "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('legacy_workspace_migrated', ?)",
    [new Date().toISOString()],
  );
}

export async function initializeLocalDatabase(): Promise<void> {
  if (!dbPromise) dbPromise = openDatabase();
  await dbPromise;
}

export async function loadWorkspace(): Promise<LocalWorkspace | null> {
  const db = await (dbPromise ??= openDatabase());
  if (!db) return readLegacyWorkspace();

  const orgRows = await db.query("SELECT id, name FROM organizations ORDER BY created_at LIMIT 1");
  const org = orgRows.values?.[0];
  if (!org) return null;

  const siteRows = await db.query(
    "SELECT id, name, location FROM sites WHERE organization_id = ? ORDER BY created_at LIMIT 1",
    [String(org.id)],
  );
  const site = siteRows.values?.[0];
  if (!site) return null;

  const plantRows = await db.query(
    "SELECT id, name, location, capacity_mw, equipment_json, server_plant_id, source FROM plants WHERE site_id = ? ORDER BY created_at",
    [String(site.id)],
  );

  // When a successful server reference-data refresh is cached, use it to decide
  // which server-managed plants are currently active. Keep stale server rows in
  // SQLite so existing audits retain their plant foreign-key/history, but hide
  // those rows from the active plant picker. If no valid cache exists, stay
  // offline-safe and show the locally stored plants as before.
  let activeServerPlantIds: Set<string> | null = null;
  try {
    const referenceRows = await db.query("SELECT value FROM app_meta WHERE key = ?", ["server_reference_data_v1"]);
    const rawReference = referenceRows.values?.[0]?.value;
    if (rawReference) {
      const reference = JSON.parse(String(rawReference));
      const referenceData = reference?.data;
      if (referenceData?.site_id && Array.isArray(referenceData?.plants)) {
        activeServerPlantIds = new Set(referenceData.plants.map((plant: any) => String(plant?.id ?? "")).filter(Boolean));
      }
    }
  } catch {
    // A missing/invalid reference cache must never block local workspace access.
  }

  let assignedUser: AssignedUserScope | undefined;
  try {
    const scopeRows = await db.query("SELECT value FROM app_meta WHERE key = ?", ["assigned_user_scope_v1"]);
    const rawScope = scopeRows.values?.[0]?.value;
    if (rawScope) {
      const parsedScope = JSON.parse(String(rawScope));
      if (parsedScope && typeof parsedScope === "object" && parsedScope.username) {
        assignedUser = parsedScope as AssignedUserScope;
      }
    }
  } catch {
    // Keep local workspace accessible if scope metadata is unreadable.
  }

  return {
    organizationName: String(org.name ?? ""),
    siteName: String(site.name ?? ""),
    siteLocation: String(site.location ?? ""),
    assignedUser,
    plants: (plantRows.values ?? [])
      .filter((row) => {
        const isServerManaged = String(row.source ?? "") === "server" || row.server_plant_id != null;
        if (!isServerManaged || activeServerPlantIds === null) return true;
        return activeServerPlantIds.has(String(row.server_plant_id ?? ""));
      })
      .map((row) => ({
        id: String(row.id),
        name: String(row.name ?? ""),
        location: String(row.location ?? ""),
        capacityMw: String(row.capacity_mw ?? ""),
        equipment: (() => { try { const parsed = JSON.parse(String(row.equipment_json ?? "[]")); return Array.isArray(parsed) ? parsed : []; } catch { return []; } })(),
        serverPlantId: row.server_plant_id == null ? undefined : String(row.server_plant_id),
        source: String(row.source ?? "local") === "server" ? "server" : "local",
      })),
  };
}

export async function saveWorkspace(workspace: LocalWorkspace): Promise<void> {
  // Keep browser preview/dev usable; Android uses SQLite.
  localStorage.setItem(LEGACY_KEY, JSON.stringify(workspace));
  const db = await (dbPromise ??= openDatabase());
  if (!db) return;

  const now = new Date().toISOString();
  const orgRows = await db.query("SELECT id FROM organizations ORDER BY created_at LIMIT 1");
  let orgId = String(orgRows.values?.[0]?.id ?? "");
  if (!orgId) {
    orgId = crypto.randomUUID();
    await db.run("INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)", [orgId, workspace.organizationName, now]);
  } else {
    await db.run("UPDATE organizations SET name = ? WHERE id = ?", [workspace.organizationName, orgId]);
  }
  const siteRows = await db.query("SELECT id FROM sites WHERE organization_id = ? ORDER BY created_at LIMIT 1", [orgId]);
  let siteId = String(siteRows.values?.[0]?.id ?? "");
  if (!siteId) {
    siteId = crypto.randomUUID();
    await db.run("INSERT INTO sites (id, organization_id, name, location, created_at) VALUES (?, ?, ?, ?, ?)", [siteId, orgId, workspace.siteName, workspace.siteLocation, now]);
  } else {
    await db.run("UPDATE sites SET name = ?, location = ? WHERE id = ?", [workspace.siteName, workspace.siteLocation, siteId]);
  }

  // Incremental upsert: never delete/recreate all plants on each save. That used to
  // discard inventory metadata and could detach existing audits from their plants.
  const incomingIds = new Set(workspace.plants.map((plant) => plant.id));
  const existingRows = await db.query("SELECT id, source, server_plant_id FROM plants WHERE site_id = ?", [siteId]);
  for (const row of existingRows.values ?? []) {
    const existingId = String(row.id);
    const isServerManaged = String(row.source ?? "") === "server" || row.server_plant_id != null;
    // Server-managed rows omitted from the active workspace may have been
    // deleted on the server. Retain them as historical rows so audits keep
    // their plant_id association; loadWorkspace hides them using the refreshed
    // server reference cache. Local plants still follow normal delete behavior.
    if (!incomingIds.has(existingId) && !isServerManaged) {
      await db.run("DELETE FROM plants WHERE id = ? AND site_id = ?", [existingId, siteId]);
    }
  }
  for (const plant of workspace.plants) {
    await db.run(
      `INSERT INTO plants (id, site_id, name, location, capacity_mw, equipment_json, server_plant_id, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, location=excluded.location,
         capacity_mw=excluded.capacity_mw, equipment_json=excluded.equipment_json,
         server_plant_id=excluded.server_plant_id, source=excluded.source`,
      [plant.id, siteId, plant.name, plant.location, plant.capacityMw, JSON.stringify(plant.equipment ?? []), plant.serverPlantId ?? null, plant.source ?? "local", now],
    );
  }

  if (workspace.assignedUser) {
    await db.run(
      "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ["assigned_user_scope_v1", JSON.stringify(workspace.assignedUser)],
    );
  } else {
    await db.run("DELETE FROM app_meta WHERE key = ?", ["assigned_user_scope_v1"]);
  }
}


export async function cacheServerReferenceData(payload: unknown): Promise<void> {
  // Cache reference data separately from the active workspace. This deliberately
  // does not alter plants, audits, observations, photos, or the sync queue.
  const serialized = JSON.stringify(payload);
  const db = await (dbPromise ??= openDatabase());
  if (db) {
    await db.run(
      "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ["server_reference_data_v1", serialized],
    );
  } else {
    localStorage.setItem("solar-audit-server-reference-data-v1", serialized);
  }
}

export async function mergeServerPlantsIntoWorkspace(workspace: LocalWorkspace, payload: any): Promise<LocalWorkspace> {
  const siteId = String(payload?.data?.site_id ?? payload?.site_id ?? "");
  const serverPlants = Array.isArray(payload?.data?.plants) ? payload.data.plants : null;
  const serverAssets = Array.isArray(payload?.data?.assets) ? payload.data.assets : null;
  const assetTypes = Array.isArray(payload?.data?.asset_types) ? payload.data.asset_types : null;
  if (!siteId || serverPlants === null || serverAssets === null || assetTypes === null) {
    throw new Error("Server reference data is incomplete; plant list was not changed.");
  }

  // The server list is authoritative for server-managed plants at this site.
  // Preserve all local-only plants and any server plants belonging to another
  // site, but rebuild this site's server-managed entries from the fresh payload.
  const currentSitePrefix = `server-plant:${siteId}:`;
  const nextPlants = workspace.plants.filter((plant: any) => {
    const isServerManaged = Boolean(plant.serverPlantId) || plant.source === "server";
    if (!isServerManaged) return true;
    return !String(plant.id ?? "").startsWith(currentSitePrefix);
  });
  for (const serverPlant of serverPlants) {
    const serverId = String(serverPlant?.id ?? "");
    const name = String(serverPlant?.name ?? "").trim();
    if (!serverId || !name) continue;
    const equipment = serverAssets
      .filter((asset: any) => String(asset?.plant_id ?? "") === serverId)
      .map((asset: any) => {
        const type = assetTypes.find((item: any) => String(item?.id ?? "") === String(asset?.asset_type_id ?? ""));
        return { id: `server-asset:${String(asset?.id ?? "")}`, name: String(asset?.name ?? "Unnamed asset"), category: String(type?.name ?? "Other / Custom") };
      });
    const serverLocalId = `server-plant:${siteId}:${serverId}`;
    const mergedPlant = {
      id: serverLocalId,
      name,
      location: String(serverPlant?.location ?? ""),
      capacityMw: String(serverPlant?.capacity_mw ?? ""),
      equipment,
      serverPlantId: serverId,
      source: "server" as const,
    };
    // If a local plant happens to have the same name, preserve it as a separate record.
    nextPlants.push(mergedPlant);
  }
  return { ...workspace, plants: nextPlants };
}

export async function loadCachedServerReferenceData(): Promise<any | null> {
  const db = await (dbPromise ??= openDatabase());
  try {
    if (db) {
      const rows = await db.query("SELECT value FROM app_meta WHERE key = ?", ["server_reference_data_v1"]);
      const raw = rows.values?.[0]?.value;
      return raw ? JSON.parse(String(raw)) : null;
    }
    const raw = localStorage.getItem("solar-audit-server-reference-data-v1");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function saveAuditSyncAcknowledgement(localAuditId: string, acknowledgement: unknown): Promise<void> {
  const key = `audit_sync_ack_v1:${localAuditId}`;
  const value = JSON.stringify(acknowledgement);
  const db = await (dbPromise ??= openDatabase());
  if (db) {
    await db.run("INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [key, value]);
  } else {
    localStorage.setItem(key, value);
  }
}

export async function loadAuditSyncAcknowledgement(localAuditId: string): Promise<any | null> {
  const key = `audit_sync_ack_v1:${localAuditId}`;
  const db = await (dbPromise ??= openDatabase());
  try {
    if (db) {
      const rows = await db.query("SELECT value FROM app_meta WHERE key = ?", [key]);
      const raw = rows.values?.[0]?.value;
      return raw ? JSON.parse(String(raw)) : null;
    }
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export async function clearWorkspace(): Promise<void> {
  localStorage.removeItem(LEGACY_KEY);
  localStorage.removeItem("solar-audit-server-reference-data-v1");
  const db = await (dbPromise ??= openDatabase());
  if (!db) return;
  // No manual BEGIN/COMMIT: avoid the inactive-transaction error.
  await db.run("DELETE FROM organizations");
  await db.run("DELETE FROM app_meta WHERE key IN ('assigned_user_scope_v1', 'server_reference_data_v1')");
}


export type AuditType = "Technical" | "Safety" | "Civil";
export type LocalAudit = {
  id: string;
  plantId: string;
  plantName: string;
  auditType: AuditType;
  title: string;
  auditDate: string;
  auditor: string;
  status: "draft" | "in_progress" | "submitted";
  startedAt: string;
  updatedAt: string;
};

const AUDITS_KEY = "solar-audit-audits-v1";

function readBrowserAudits(): LocalAudit[] {
  try {
    const value = JSON.parse(localStorage.getItem(AUDITS_KEY) ?? "[]");
    return Array.isArray(value) ? value as LocalAudit[] : [];
  } catch {
    return [];
  }
}

async function findCurrentSiteId(connection: SQLiteDBConnection): Promise<string | null> {
  const rows = await connection.query("SELECT id FROM sites ORDER BY created_at LIMIT 1");
  return rows.values?.[0]?.id ? String(rows.values[0].id) : null;
}

export async function loadAudits(): Promise<LocalAudit[]> {
  const db = await (dbPromise ??= openDatabase());
  if (!db) return readBrowserAudits();

  const rows = await db.query(`
    SELECT a.id, a.plant_id, COALESCE(p.name, '') AS plant_name,
           a.audit_type, a.title, a.audit_date, a.auditor, a.status,
           a.started_at, a.updated_at
    FROM audits a
    LEFT JOIN plants p ON p.id = a.plant_id
    ORDER BY a.updated_at DESC
  `);
  return (rows.values ?? []).map((row) => ({
    id: String(row.id),
    plantId: String(row.plant_id ?? ""),
    plantName: String(row.plant_name ?? ""),
    auditType: String(row.audit_type) as AuditType,
    title: String(row.title ?? ""),
    auditDate: String(row.audit_date ?? ""),
    auditor: String(row.auditor ?? ""),
    status: String(row.status ?? "draft") as LocalAudit["status"],
    startedAt: String(row.started_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  }));
}

export async function createAudit(input: {
  plantId: string;
  auditType: AuditType;
  title: string;
  auditDate: string;
  auditor: string;
}): Promise<LocalAudit> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const db = await (dbPromise ??= openDatabase());

  if (!db) {
    const audits = readBrowserAudits();
    const audit: LocalAudit = {
      id, plantId: input.plantId,
      plantName: "",
      auditType: input.auditType,
      title: input.title.trim(),
      auditDate: input.auditDate,
      auditor: input.auditor.trim(),
      status: "draft",
      startedAt: now,
      updatedAt: now,
    };
    localStorage.setItem(AUDITS_KEY, JSON.stringify([audit, ...audits]));
    return audit;
  }

  const siteId = await findCurrentSiteId(db);
  if (!siteId) throw new Error("Create a workspace site before creating an audit.");
  await db.run(
    `INSERT INTO audits (id, site_id, plant_id, audit_type, title, status, started_at, updated_at, auditor, audit_date)
     VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
    [id, siteId, input.plantId || null, input.auditType, input.title.trim(), now, now, input.auditor.trim(), input.auditDate],
  );
  const plants = await db.query("SELECT name FROM plants WHERE id = ?", [input.plantId]);
  return {
    id, plantId: input.plantId, plantName: String(plants.values?.[0]?.name ?? ""),
    auditType: input.auditType, title: input.title.trim(), auditDate: input.auditDate,
    auditor: input.auditor.trim(), status: "draft", startedAt: now, updatedAt: now,
  };
}


export type AuditCheckpoint = {
  id: string;
  equipmentId: string;
  checkpointText: string;
  result: "C" | "NC" | "NA" | "OFI";
  remarks: string;
  photos: PhotoItem[];
  updatedAt: string;
};
export type AuditEquipment = {
  id: string;
  name: string;
  equipmentType: string;
  createdAt: string;
  checkpoints: AuditCheckpoint[];
};
const EXECUTION_KEY = "solar-audit-execution-v1";
type BrowserExecution = Record<string, AuditEquipment[]>;

function readBrowserExecution(): BrowserExecution {
  try {
    const value = JSON.parse(localStorage.getItem(EXECUTION_KEY) ?? "{}");
    return value && typeof value === "object" ? value as BrowserExecution : {};
  } catch { return {}; }
}

function parsePhotoRefArray(rawJson: unknown): PhotoItem[] {
  try {
    const val = JSON.parse(String(rawJson ?? "[]"));
    return Array.isArray(val) ? val.map(normalizePhotoEntry).filter((p): p is PhotoItem => p !== null) : [];
  } catch {
    return [];
  }
}

/** Load audit equipment and checkpoints with lightweight photo refs (no base64 hydration). */
export async function loadAuditExecutionPhotoRefs(auditId: string): Promise<AuditEquipment[]> {
  const db = await (dbPromise ??= openDatabase());
  if (!db) return readBrowserExecution()[auditId] ?? [];
  const equipmentRows = await db.query(
    "SELECT id, name, equipment_type, created_at FROM audit_equipment WHERE audit_id = ? ORDER BY created_at",
    [auditId],
  );
  const result: AuditEquipment[] = [];
  for (const row of equipmentRows.values ?? []) {
    const equipmentId = String(row.id);
    const checkpointRows = await db.query(
      "SELECT id, equipment_id, checkpoint_text, result, remarks, photos_json, updated_at FROM audit_checkpoints WHERE audit_id = ? AND equipment_id = ? ORDER BY rowid",
      [auditId, equipmentId],
    );
    const checkpoints: AuditCheckpoint[] = [];
    for (const cp of checkpointRows.values ?? []) {
      checkpoints.push({
        id: String(cp.id),
        equipmentId,
        checkpointText: String(cp.checkpoint_text ?? ""),
        result: String(cp.result ?? "NA") as AuditCheckpoint["result"],
        remarks: String(cp.remarks ?? ""),
        photos: parsePhotoRefArray(cp.photos_json),
        updatedAt: String(cp.updated_at ?? ""),
      });
    }
    result.push({
      id: equipmentId,
      name: String(row.name ?? ""),
      equipmentType: String(row.equipment_type ?? ""),
      createdAt: String(row.created_at ?? ""),
      checkpoints,
    });
  }
  return result;
}

export async function loadAuditExecution(auditId: string): Promise<AuditEquipment[]> {
  const db = await (dbPromise ??= openDatabase());
  if (!db) return readBrowserExecution()[auditId] ?? [];
  const equipmentRows = await db.query(
    "SELECT id, name, equipment_type, created_at FROM audit_equipment WHERE audit_id = ? ORDER BY created_at",
    [auditId],
  );
  const result: AuditEquipment[] = [];
  for (const row of equipmentRows.values ?? []) {
    const equipmentId = String(row.id);
    const checkpointRows = await db.query(
      "SELECT id, equipment_id, checkpoint_text, result, remarks, photos_json, updated_at FROM audit_checkpoints WHERE audit_id = ? AND equipment_id = ? ORDER BY rowid",
      [auditId, equipmentId],
    );
    const checkpoints: AuditCheckpoint[] = [];
    for (const cp of checkpointRows.values ?? []) {
      checkpoints.push({
        id: String(cp.id),
        equipmentId,
        checkpointText: String(cp.checkpoint_text ?? ""),
        result: String(cp.result ?? "NA") as AuditCheckpoint["result"],
        remarks: String(cp.remarks ?? ""),
        photos: await resolvePhotosFromFilesystem(cp.photos_json),
        updatedAt: String(cp.updated_at ?? ""),
      });
    }
    result.push({
      id: equipmentId,
      name: String(row.name ?? ""),
      equipmentType: String(row.equipment_type ?? ""),
      createdAt: String(row.created_at ?? ""),
      checkpoints,
    });
  }
  return result;
}

export async function addAuditEquipment(auditId: string, name: string, equipmentType: string): Promise<AuditEquipment> {
  const now = new Date().toISOString();
  const equipment: AuditEquipment = { id: crypto.randomUUID(), name: name.trim(), equipmentType: equipmentType.trim(), createdAt: now, checkpoints: [] };
  const db = await (dbPromise ??= openDatabase());
  if (!db) {
    const all = readBrowserExecution();
    all[auditId] = [...(all[auditId] ?? []), equipment];
    localStorage.setItem(EXECUTION_KEY, JSON.stringify(all));
    return equipment;
  }
  await db.run(
    "INSERT INTO audit_equipment (id, audit_id, name, equipment_type, created_at) VALUES (?, ?, ?, ?, ?)",
    [equipment.id, auditId, equipment.name, equipment.equipmentType, now],
  );
  await db.run("UPDATE audits SET status = 'in_progress', updated_at = ? WHERE id = ?", [now, auditId]);
  return equipment;
}

export async function addAuditCheckpoint(auditId: string, equipmentId: string, checkpointText: string): Promise<AuditCheckpoint> {
  const now = new Date().toISOString();
  const checkpoint: AuditCheckpoint = { id: crypto.randomUUID(), equipmentId, checkpointText: checkpointText.trim(), result: "NA", remarks: "", photos: [], updatedAt: now };
  const db = await (dbPromise ??= openDatabase());
  if (!db) {
    const all = readBrowserExecution();
    all[auditId] = (all[auditId] ?? []).map((eq) => eq.id === equipmentId ? { ...eq, checkpoints: [...eq.checkpoints, checkpoint] } : eq);
    localStorage.setItem(EXECUTION_KEY, JSON.stringify(all));
    return checkpoint;
  }
  await db.run(
    "INSERT INTO audit_checkpoints (id, audit_id, equipment_id, checkpoint_text, result, remarks, updated_at) VALUES (?, ?, ?, ?, 'NA', '', ?)",
    [checkpoint.id, auditId, equipmentId, checkpoint.checkpointText, now],
  );
  await db.run("UPDATE audits SET status = 'in_progress', updated_at = ? WHERE id = ?", [now, auditId]);
  return checkpoint;
}

export async function updateAuditCheckpoint(auditId: string, checkpoint: AuditCheckpoint): Promise<void> {
  const now = new Date().toISOString();
  const updated = { ...checkpoint, updatedAt: now };
  const db = await (dbPromise ??= openDatabase());
  if (!db) {
    const all = readBrowserExecution();
    all[auditId] = (all[auditId] ?? []).map((eq) => ({
      ...eq, checkpoints: eq.checkpoints.map((cp) => cp.id === checkpoint.id ? updated : cp),
    }));
    localStorage.setItem(EXECUTION_KEY, JSON.stringify(all));
    return;
  }
  const storedPhotos = await persistPhotosToFilesystem(checkpoint.photos ?? [], checkpoint.id);
  await db.run(
    "UPDATE audit_checkpoints SET result = ?, remarks = ?, photos_json = ?, updated_at = ? WHERE id = ? AND audit_id = ?",
    [checkpoint.result, checkpoint.remarks, JSON.stringify(storedPhotos), now, checkpoint.id, auditId],
  );
  await db.run("UPDATE audits SET status = 'in_progress', updated_at = ? WHERE id = ?", [now, auditId]);
}

export async function refreshAuditStatus(auditId: string): Promise<void> {
  const db = await (dbPromise ??= openDatabase());
  if (!db) return;
  await db.run("UPDATE audits SET status = 'in_progress', updated_at = ? WHERE id = ? AND status = 'draft'", [new Date().toISOString(), auditId]);
}


export type FindingType = "NC" | "OFI";
export type ObservationStatus = "open" | "in_progress" | "submitted" | "closed" | "rejected" | "reopened" | "withdrawn";
export type LocalObservation = {
  id: string; auditId: string; auditTitle: string; plantName: string; checkpointId: string | null;
  checkpointText: string; findingType: FindingType; title: string; description: string; severity: string;
  responsiblePerson: string; actionText: string; status: ObservationStatus; targetDate: string; closureDate: string;
  createdAt: string; updatedAt: string; photos: PhotoItem[]; actionPhotos: PhotoItem[];
  equipmentName?: string; equipmentType?: string; serverObservationId?: string; syncStatus?: "local" | "synced" | "pending" | "error"; syncError?: string;
};
const OBSERVATIONS_KEY = "solar-audit-observations-v1";
function readBrowserObservations(): LocalObservation[] {
  try { const value = JSON.parse(localStorage.getItem(OBSERVATIONS_KEY) ?? "[]"); return Array.isArray(value) ? value as LocalObservation[] : []; } catch { return []; }
}
export async function loadObservations(): Promise<LocalObservation[]> {
  const db = await (dbPromise ??= openDatabase());
  if (!db) { const execution = readBrowserExecution(); const allCheckpoints = Object.values(execution).flatMap(items => items).flatMap(eq => eq.checkpoints); return readBrowserObservations().filter(o => o.status !== 'withdrawn').map(o => ({ ...o, checkpointText: o.checkpointText || o.title || '', syncStatus: o.syncStatus ?? 'local', photos: allCheckpoints.find(cp => cp.id === o.checkpointId)?.photos ?? o.photos ?? [], actionPhotos: o.actionPhotos ?? [] })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  const rows = await db.query(`SELECT o.*, a.title AS audit_title, COALESCE(p.name,'') AS plant_name, COALESCE(NULLIF(c.checkpoint_text,''), o.title, '') AS checkpoint_text, COALESCE(eq.name, eq.equipment_type, '') AS equipment_name, COALESCE(eq.equipment_type, '') AS equipment_type, COALESCE(c.photos_json, '[]') AS checkpoint_photos_json
    FROM observations o JOIN audits a ON a.id=o.audit_id LEFT JOIN plants p ON p.id=a.plant_id
    LEFT JOIN audit_checkpoints c ON c.id=o.checkpoint_id LEFT JOIN audit_equipment eq ON eq.id=c.equipment_id
    WHERE o.status != 'withdrawn'
    ORDER BY o.updated_at DESC`);
  const items: LocalObservation[] = [];
  for (const r of rows.values ?? []) {
    items.push({
      id: String(r.id),
      auditId: String(r.audit_id),
      auditTitle: String(r.audit_title ?? ""),
      plantName: String(r.plant_name ?? ""),
      checkpointId: r.checkpoint_id == null ? null : String(r.checkpoint_id),
      checkpointText: String(r.checkpoint_text ?? ""),
      equipmentName: String(r.equipment_name ?? ""),
      equipmentType: String(r.equipment_type ?? ""),
      serverObservationId: r.server_observation_id == null ? undefined : String(r.server_observation_id),
      syncStatus: String(r.sync_status ?? "local") as LocalObservation["syncStatus"],
      syncError: String(r.sync_error ?? ""),
      findingType: String(r.finding_type ?? "NC") as FindingType,
      title: String(r.title ?? ""),
      description: String(r.description ?? ""),
      severity: String(r.severity ?? ""),
      responsiblePerson: String(r.responsible_person ?? ""),
      actionText: String(r.action_text ?? ""),
      status: String(r.status ?? "open") as ObservationStatus,
      targetDate: String(r.target_date ?? ""),
      closureDate: String(r.closure_date ?? ""),
      createdAt: String(r.created_at ?? ""),
      updatedAt: String(r.updated_at ?? ""),
      photos: await resolvePhotosFromFilesystem(r.checkpoint_photos_json),
      actionPhotos: await resolvePhotosFromFilesystem(r.action_photos_json),
    });
  }
  return items;
}
export async function createObservation(input: { auditId: string; checkpointId: string; findingType: FindingType; title: string; description: string; severity: string; responsiblePerson: string; actionText: string; targetDate: string }): Promise<string> {
  const now = new Date().toISOString(); const id = crypto.randomUUID();
  const db = await (dbPromise ??= openDatabase());
  if (!db) {
    const audits = readBrowserAudits(); const audit = audits.find(a => a.id === input.auditId);
    const execution = readBrowserExecution(); const eq = Object.values(execution).flatMap(x => x).find(e => e.checkpoints.some(c => c.id === input.checkpointId)); const cp = eq?.checkpoints.find(c => c.id === input.checkpointId);
    const item: LocalObservation = { id, auditId: input.auditId, auditTitle: audit?.title ?? '', plantName: audit?.plantName ?? '', checkpointId: input.checkpointId, checkpointText: cp?.checkpointText ?? '', equipmentName: eq?.name ?? '', equipmentType: eq?.equipmentType ?? '', syncStatus: 'local', photos: cp?.photos ?? [], actionPhotos: [], findingType: input.findingType, title: input.title.trim(), description: input.description.trim(), severity: input.severity, responsiblePerson: input.responsiblePerson.trim(), actionText: input.actionText.trim(), status: 'open', targetDate: input.targetDate, closureDate: '', createdAt: now, updatedAt: now };
    localStorage.setItem(OBSERVATIONS_KEY, JSON.stringify([item, ...readBrowserObservations()])); return id;
  }
  await db.run(`INSERT INTO observations (id,audit_id,checkpoint_id,title,description,finding_type,severity,responsible_person,action_text,status,target_date,server_observation_id,sync_status,sync_error,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'open',?,NULL,'local','',?,?)`, [id, input.auditId, input.checkpointId, input.title.trim(), input.description.trim(), input.findingType, input.severity, input.responsiblePerson.trim(), input.actionText.trim(), input.targetDate || null, now, now]);
  return id;
}


export async function linkObservationToServer(input: {
  id: string; serverObservationId: string; status: string; severity: string;
  responsiblePerson: string; description: string; actionText: string;
  targetDate: string; closureDate: string; findingType?: FindingType;
  checkpointId?: string | null; serverUpdatedAt?: string | null; preserveLocal?: boolean;
}): Promise<void> {
  const now = input.serverUpdatedAt || new Date().toISOString();
  const db = await (dbPromise ??= openDatabase());
  const status = input.status as ObservationStatus;
  const severity = input.severity ? input.severity.charAt(0).toUpperCase() + input.severity.slice(1).toLowerCase() : "";
  if (!db) {
    const items = readBrowserObservations().map((o) => o.id === input.id ? (input.preserveLocal ? {
      ...o, serverObservationId: input.serverObservationId, findingType: input.findingType ?? o.findingType, checkpointId: input.checkpointId ?? o.checkpointId, syncStatus: "pending" as const, syncError: "", updatedAt: now,
    } : {
      ...o, serverObservationId: input.serverObservationId, findingType: input.findingType ?? o.findingType, checkpointId: input.checkpointId ?? o.checkpointId, syncStatus: "synced" as const, syncError: "",
      status, severity, responsiblePerson: input.responsiblePerson, description: input.description,
      actionText: input.actionText, targetDate: input.targetDate, closureDate: input.closureDate, updatedAt: now,
    }) : o);
    localStorage.setItem(OBSERVATIONS_KEY, JSON.stringify(items));
    return;
  }
  if (input.preserveLocal) {
    await db.run("UPDATE observations SET server_observation_id=?, finding_type=COALESCE(?, finding_type), checkpoint_id=COALESCE(?, checkpoint_id), sync_status='pending', sync_error='', updated_at=? WHERE id=?",
      [input.serverObservationId, input.findingType ?? null, input.checkpointId ?? null, now, input.id]);
    return;
  }
  await db.run(`UPDATE observations SET server_observation_id=?, finding_type=COALESCE(?, finding_type), checkpoint_id=COALESCE(?, checkpoint_id), sync_status='synced', sync_error='', status=?, severity=?, responsible_person=?, description=?, action_text=?, target_date=?, closure_date=?, updated_at=? WHERE id=?`,
    [input.serverObservationId, input.findingType ?? null, input.checkpointId ?? null, status, severity, input.responsiblePerson, input.description, input.actionText, input.targetDate || null, input.closureDate || null, now, input.id]);
}

export async function deleteObservation(id: string): Promise<void> {
  const db = await (dbPromise ??= openDatabase());
  if (!db) {
    const items = readBrowserObservations().filter((o) => o.id !== id);
    localStorage.setItem(OBSERVATIONS_KEY, JSON.stringify(items));
    return;
  }
  await db.run("DELETE FROM observations WHERE id=?", [id]);
}

export async function markObservationSyncError(id: string, error: string): Promise<void> {
  const db = await (dbPromise ??= openDatabase());
  if (!db) {
    const items = readBrowserObservations().map((o) => o.id === id ? { ...o, syncStatus: "error" as const, syncError: error } : o);
    localStorage.setItem(OBSERVATIONS_KEY, JSON.stringify(items));
    return;
  }
  await db.run("UPDATE observations SET sync_status='error', sync_error=?, updated_at=? WHERE id=?", [error.slice(0, 1000), new Date().toISOString(), id]);
}

export async function saveObservationActionPhotos(id: string, photos: Array<PhotoItem | string>): Promise<void> {
  const normalized = (photos ?? []).map(normalizePhotoEntry).filter((p): p is PhotoItem => p !== null);
  const db = await (dbPromise ??= openDatabase());
  if (!db) { const items = readBrowserObservations().map(o => o.id === id ? { ...o, actionPhotos: normalized, syncStatus: "pending" as const, updatedAt: new Date().toISOString() } : o); localStorage.setItem(OBSERVATIONS_KEY, JSON.stringify(items)); return; }
  const storedPhotos = await persistPhotosToFilesystem(normalized, `obs_${id}`);
  await db.run("UPDATE observations SET action_photos_json=?, sync_status='pending', updated_at=? WHERE id=?", [JSON.stringify(storedPhotos), new Date().toISOString(), id]);
}

export async function updateObservationStatus(id: string, status: ObservationStatus): Promise<void> {
  const now = new Date().toISOString(); const closureDate = status === 'closed' ? now.slice(0, 10) : null;
  const db = await (dbPromise ??= openDatabase());
  if (!db) { const items = readBrowserObservations().map(o => o.id === id ? { ...o, status, closureDate: closureDate ?? '', syncStatus: "pending" as const, updatedAt: now } : o); localStorage.setItem(OBSERVATIONS_KEY, JSON.stringify(items)); return; }
  await db.run("UPDATE observations SET status=?, closure_date=?, sync_status='pending', updated_at=? WHERE id=?", [status, closureDate, now, id]);
}


export async function updateAuditType(auditId: string, auditType: AuditType): Promise<void> {
  const now = new Date().toISOString();
  const db = await (dbPromise ??= openDatabase());
  if (!db) {
    const audits = readBrowserAudits().map((audit) => audit.id === auditId ? { ...audit, auditType, updatedAt: now } : audit);
    localStorage.setItem(AUDITS_KEY, JSON.stringify(audits));
    return;
  }
  await db.run("UPDATE audits SET audit_type=?, updated_at=? WHERE id=? AND status!='submitted'", [auditType, now, auditId]);
}


/** Reconcile only status fields returned by the server; preserve all local audit content. */
export async function reconcileServerAuditStatuses(items: Array<{ id: string; status: string; updated_at?: string | null }>): Promise<number> {
  const normalized = items.filter((item) => item && typeof item.id === "string" && item.id.trim()).map((item) => ({
    id: item.id, status: String(item.status || "").toLowerCase(), updatedAt: String(item.updated_at || new Date().toISOString()),
  })).filter((item) => ["draft", "open", "in_progress", "in progress", "submitted", "closed", "reopened", "rejected"].includes(item.status));
  const db = await (dbPromise ??= openDatabase());
  let changed = 0;
  const mapStatus = (status: string): LocalAudit["status"] => ["submitted", "closed"].includes(status) ? "submitted" : ["in_progress", "in progress", "open", "reopened", "rejected"].includes(status) ? "in_progress" : "draft";
  if (!db) {
    const remote = new Map(normalized.map((item) => [item.id, item]));
    const audits = readBrowserAudits().map((audit) => { const item = remote.get(audit.id); if (!item) return audit; const status = mapStatus(item.status); if (audit.status === status) return audit; changed++; return { ...audit, status, updatedAt: item.updatedAt }; });
    localStorage.setItem(AUDITS_KEY, JSON.stringify(audits));
    return changed;
  }
  for (const item of normalized) {
    const status = mapStatus(item.status);
    const result = await db.run("UPDATE audits SET status=?, updated_at=? WHERE id=? AND status!=?", [status, item.updatedAt, item.id, status]);
    if ((result as any)?.changes?.changes) changed += Number((result as any).changes.changes);
  }
  return changed;
}


export async function markAuditSubmitted(auditId: string): Promise<void> {
  const now = new Date().toISOString();
  const db = await (dbPromise ??= openDatabase());
  if (!db) {
    const audits = readBrowserAudits().map((audit) => audit.id === auditId ? { ...audit, status: "submitted" as const, updatedAt: now } : audit);
    localStorage.setItem(AUDITS_KEY, JSON.stringify(audits));
    return;
  }
  await db.run("UPDATE audits SET status='submitted', updated_at=? WHERE id=?", [now, auditId]);
}

export async function updateObservationDetails(input: {
  id: string; title: string; description: string; severity: string;
  responsiblePerson: string; actionText: string; targetDate: string; closureDate?: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const db = await (dbPromise ??= openDatabase());
  if (!db) {
    const items = readBrowserObservations().map((o) => o.id === input.id ? {
      ...o, title: input.title.trim(), description: input.description.trim(), severity: input.severity,
      responsiblePerson: input.responsiblePerson.trim(), actionText: input.actionText.trim(),
      targetDate: input.targetDate, closureDate: input.closureDate ?? o.closureDate, syncStatus: 'pending' as const, updatedAt: now,
    } : o);
    localStorage.setItem(OBSERVATIONS_KEY, JSON.stringify(items));
    return;
  }
  await db.run(
    "UPDATE observations SET title=?, description=?, severity=?, responsible_person=?, action_text=?, target_date=?, closure_date=?, sync_status='pending', updated_at=? WHERE id=?",
    [input.title.trim(), input.description.trim(), input.severity, input.responsiblePerson.trim(), input.actionText.trim(), input.targetDate || null, input.closureDate || null, now, input.id],
  );
}
