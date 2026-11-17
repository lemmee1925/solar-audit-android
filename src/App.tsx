import { useEffect, useMemo, useState } from "react";
import { Camera, CameraDirection, CameraResultType, CameraSource } from "@capacitor/camera";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import "./styles.css";
import { TECHNICAL_CHECKLISTS, TECHNICAL_CATEGORIES, SAFETY_CHECKLIST, CIVIL_CHECKLIST } from "./checklistLibrary";
import { addAuditCheckpoint, addAuditEquipment, clearWorkspace, createAudit, initializeLocalDatabase, loadAuditExecution, loadAuditExecutionPhotoRefs, resolvePhotoRef, loadAudits, loadWorkspace, saveWorkspace, updateAuditCheckpoint, type AuditCheckpoint, type AuditEquipment, type AuditType, type AssignedUserScope, type LocalAudit, type LocalObservation, type FindingType, type PhotoItem, loadObservations, createObservation, deleteObservation, markAuditSubmitted, updateAuditType, updateObservationDetails, saveObservationActionPhotos, linkObservationToServer, markObservationSyncError, cacheServerReferenceData, loadCachedServerReferenceData, mergeServerPlantsIntoWorkspace, saveAuditSyncAcknowledgement, reconcileServerAuditStatuses } from "./db";
import { authenticateAndBootstrap, downloadSiteReferenceData, createServerPlant, createServerAsset, renameServerAsset, deleteServerAsset, getServerPlantSpecs, saveServerPlantSpecs, syncAuditManifest, syncAuditPhoto, completeServerAudit, fetchServerAuditStatuses, fetchServerObservations, saveServerObservationDetails, updateServerObservationAction, uploadServerObservationPhoto, type MobileBootstrap, type AuditManifestPayload } from "./serverApi";

type PlantEquipment = {
  id: string;
  name: string;
  category: string;
};

type Plant = {
  id: string;
  name: string;
  location: string;
  capacityMw: string;
  equipment?: PlantEquipment[];
  serverPlantId?: string;
  source?: "local" | "server";
};

type EquipmentPlan = { category: string; quantity: number };

type Workspace = {
  organizationName: string;
  siteName: string;
  siteLocation: string;
  plants: Plant[];
  assignedUser?: AssignedUserScope;
};

type Section = "Dashboard" | "Sites & Plants" | "Audits" | "Observations" | "Reports" | "Settings";

const STORAGE_KEY = "solar-audit-workspace-v1";
const emptyWorkspace: Workspace = {
  organizationName: "",
  siteName: "",
  siteLocation: "",
  plants: [],
};

function readWorkspace(): Workspace | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Workspace;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.plants)) return null;
    return { ...emptyWorkspace, ...parsed, plants: parsed.plants };
  } catch {
    return null;
  }
}

function Icon({ name }: { name: string }) {
  const common = { width: 19, height: 19, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const paths: Record<string, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    site: <><path d="M3 21h18" /><path d="M5 21V7l7-4 7 4v14" /><path d="M9 21v-5h6v5" /><path d="M9 9h.01M15 9h.01M9 12h.01M15 12h.01" /></>,
    audit: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
    eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" /><circle cx="12" cy="12" r="2.5" /></>,
    report: <><path d="M5 3h10l4 4v14H5z" /><path d="M15 3v5h4M8 12h8M8 16h8" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a7.7 7.7 0 0 1-1.7 1l-.3 1.8h-2.8l-.3-1.8a7.7 7.7 0 0 1-1.7-1l-1.7.6-1.4-2.4 1.4-1.1a7.4 7.4 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.6a7.7 7.7 0 0 1 1.7-1l.3-1.8h2.8l.3 1.8a7.7 7.7 0 0 1 1.7 1l1.7-.6 1.4 2.4-1.4 1.1a7.4 7.4 0 0 1 0 2Z" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
    plant: <><path d="M12 21v-9" /><path d="M12 12C4 12 4 5 4 5s7-1 8 7Z" /><path d="M12 16c0-7 8-8 8-8s1 7-8 8Z" /></>,
    cloud: <><path d="M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 20 11a3.5 3.5 0 0 1-.5 7H7Z" /></>,
  };
  return <svg {...common} aria-hidden="true">{paths[name] ?? paths.grid}</svg>;
}


function stableObservationPhotoId(observationId: string, dataUrl: string): string {
  const input = `${observationId}:${dataUrl}`;
  const hash32 = (value: string, salt: number) => {
    let hash = (2166136261 ^ salt) >>> 0;
    for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619) >>> 0;
    return hash.toString(16).padStart(8, "0");
  };
  const raw = `${hash32(input, 0)}${hash32(input, 0x9e3779b9)}${hash32(input, 0x85ebca6b)}${hash32(input, 0xc2b2ae35)}`.split("");
  raw[12] = "4";
  raw[16] = ((parseInt(raw[16], 16) & 0x3) | 0x8).toString(16);
  const hex = raw.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

async function captureCurrentLocation(): Promise<{ latitude: number; longitude: number; accuracy: number } | null> {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) return null;
  return new Promise((resolve) => {
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({
          latitude: Number(pos.coords.latitude.toFixed(6)),
          longitude: Number(pos.coords.longitude.toFixed(6)),
          accuracy: Math.round(pos.coords.accuracy || 0),
        }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 7000, maximumAge: 15000 },
      );
    } catch {
      resolve(null);
    }
  });
}

function openPhotoLocationInMaps(latitude: number, longitude: number) {
  const lat = latitude.toFixed(6);
  const lon = longitude.toFixed(6);
  const geoUrl = `geo:${lat},${lon}?q=${lat},${lon}(Solar+Audit+Photo)`;
  const webUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
  const isNative = Boolean((window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
  window.open(isNative ? geoUrl : webUrl, "_blank", "noopener,noreferrer");
}

function renderPhotoLocationBadge(photo: PhotoItem) {
  if (typeof photo.latitude !== "number" || typeof photo.longitude !== "number") return null;
  const lat = photo.latitude.toFixed(5);
  const lon = photo.longitude.toFixed(5);
  return (
    <button
      type="button"
      className="photo-gps-badge"
      title="Open this photo location in Maps"
      onClick={(e) => {
        e.stopPropagation();
        openPhotoLocationInMaps(photo.latitude!, photo.longitude!);
      }}
    >
      📍 {lat}, {lon}
    </button>
  );
}

async function photoFileToDataUrl(file: File): Promise<string> {
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read photo."));
    reader.onerror = () => reject(new Error("Could not read photo."));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not process photo."));
    img.src = source;
  });
  const maxDimension = 1600;
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Photo processing is not available on this device.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.78);
}

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(() => readWorkspace());
  const [section, setSection] = useState<Section>("Dashboard");
  const [plantName, setPlantName] = useState("");
  const [plantLocation, setPlantLocation] = useState("");
  const [plantCapacity, setPlantCapacity] = useState("");
  const [plantEquipmentCategory, setPlantEquipmentCategory] = useState("");
  const [plantEquipmentQuantity, setPlantEquipmentQuantity] = useState("1");
  const [plantEquipmentPlan, setPlantEquipmentPlan] = useState<EquipmentPlan[]>([]);
  const [configurePlantId, setConfigurePlantId] = useState("");
  const [existingEquipmentCategory, setExistingEquipmentCategory] = useState("");
  const [existingEquipmentQuantity, setExistingEquipmentQuantity] = useState("1");
  const [showPlantForm, setShowPlantForm] = useState(false);
  const [message, setMessage] = useState("");
  const [serverBaseUrl, setServerBaseUrl] = useState(() => {
    try {
      return localStorage.getItem("solarAuditNativeApiBaseUrl") || "http://10.0.2.2:5010/api/mobile/v1";
    } catch {
      return "http://10.0.2.2:5010/api/mobile/v1";
    }
  });
  // The API address is non-secret configuration and may be remembered on this device.
  // Credentials and bearer tokens remain memory-only and are never persisted.
  useEffect(() => {
    try {
      if (serverBaseUrl.trim()) localStorage.setItem("solarAuditNativeApiBaseUrl", serverBaseUrl.trim());
    } catch {
      // Keep the app usable if device storage is unavailable.
    }
  }, [serverBaseUrl]);
  const [serverUsername, setServerUsername] = useState("");
  const [serverPassword, setServerPassword] = useState("");
  const [serverToken, setServerToken] = useState("");
  const [serverBootstrap, setServerBootstrap] = useState<MobileBootstrap | null>(null);
  const [serverAssetTypes, setServerAssetTypes] = useState<Array<{ id: number | string; name: string }>>([]);
  const [serverBusy, setServerBusy] = useState(false);
  const [serverMessage, setServerMessage] = useState("");
  const [referenceDataMessage, setReferenceDataMessage] = useState("");
  const [referenceDataBusy, setReferenceDataBusy] = useState(false);
  const [auditSyncBusyId, setAuditSyncBusyId] = useState("");
  const [auditSyncMessages, setAuditSyncMessages] = useState<Record<string, string>>({});
  const [storageReady, setStorageReady] = useState(false);
  const [audits, setAudits] = useState<LocalAudit[]>([]);
  const [showAuditForm, setShowAuditForm] = useState(false);
  const [continueAfterCreate, setContinueAfterCreate] = useState(false);
  const [auditType] = useState<AuditType>("Technical");
  const [auditTitle, setAuditTitle] = useState("");
  const [auditPlantId, setAuditPlantId] = useState("");
  const [auditDate, setAuditDate] = useState(new Date().toISOString().slice(0, 10));
  const [auditAuditor, setAuditAuditor] = useState("");
  const [activeAudit, setActiveAudit] = useState<LocalAudit | null>(null);
  const [summaryAudit, setSummaryAudit] = useState<LocalAudit | null>(null);
  const [executionEquipment, setExecutionEquipment] = useState<AuditEquipment[]>([]);
  const [selectedEquipmentId, setSelectedEquipmentId] = useState("");
  const [equipmentName, setEquipmentName] = useState("");
  const [equipmentType, setEquipmentType] = useState("");
  const [observations, setObservations] = useState<LocalObservation[]>([]);
  const [observationDraft, setObservationDraft] = useState<{ auditId: string; checkpointId: string; findingType: FindingType; checkpointText: string; observationId?: string } | null>(null);
  const [observationTitle, setObservationTitle] = useState("");
  const [observationDescription, setObservationDescription] = useState("");
  const [observationSeverity, setObservationSeverity] = useState("");
  const [observationResponsible, setObservationResponsible] = useState("");
  const [observationAction, setObservationAction] = useState("");
  const [observationTargetDate, setObservationTargetDate] = useState("");
  const [observationClosureDate, setObservationClosureDate] = useState("");
  const [observationActionPhotos, setObservationActionPhotos] = useState<PhotoItem[]>([]);
  const [observationSearch, setObservationSearch] = useState("");
  const [observationFindingFilter, setObservationFindingFilter] = useState<"ALL" | FindingType>("ALL");
  const [observationStatusFilter, setObservationStatusFilter] = useState("all");
  const [observationPlantFilter, setObservationPlantFilter] = useState("all");
  const [reportSearch, setReportSearch] = useState("");
  const [reportStatusFilter, setReportStatusFilter] = useState("all");
  const [specPlant, setSpecPlant] = useState<Plant | null>(null);
  const [specValues, setSpecValues] = useState<Record<string, string>>({});
  const [specSaving, setSpecSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function startStorage() {
      try {
        await initializeLocalDatabase();
        const stored = await loadWorkspace();
        const cachedReference = await loadCachedServerReferenceData();
        const cachedTypes = Array.isArray(cachedReference?.data?.asset_types) ? cachedReference.data.asset_types : [];
        if (!cancelled) setServerAssetTypes(cachedTypes.filter((item: any) => item && item.name).map((item: any) => ({ id: item.id, name: String(item.name).trim() })).sort((a: any, b: any) => a.name.localeCompare(b.name)));
        if (!cancelled && stored) setWorkspace(stored);
      } catch (error) {
        console.error("[Solar Audit] Local database startup failed:", error);
        if (!cancelled) setMessage("Database could not be opened. Your existing device data has been preserved.");
      } finally {
        if (!cancelled) setStorageReady(true);
      }
    }
    void startStorage();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    if (workspace) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
      void saveWorkspace(workspace).catch((error) => {
        console.error("[Solar Audit] Workspace save failed:", error);
        setMessage("Could not save workspace to the local database. Please keep the app open and retry.");
      });
    } else {
      localStorage.removeItem(STORAGE_KEY);
      void clearWorkspace().catch((error) => {
        console.error("[Solar Audit] Workspace reset failed:", error);
        setMessage("Workspace reset could not be fully saved to the local database.");
      });
    }
  }, [workspace, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    let cancelled = false;
    void loadAudits().then((items) => {
      if (!cancelled) setAudits(items);
    }).catch((error) => {
      console.error("[Solar Audit] Audit load failed:", error);
      if (!cancelled) setMessage("Could not load saved audits. Existing data has been preserved.");
    });
    void loadObservations().then((items) => { if (!cancelled) setObservations(items); }).catch((error) => console.error("[Solar Audit] Observation load failed:", error));
    return () => { cancelled = true; };
  }, [storageReady]);

  async function generateAuditReport(audit: LocalAudit) {
    try {
      setMessage(`Preparing report for “${audit.title}”…`);
      const execution = await loadAuditExecution(audit.id);
      const allObservations = await loadObservations();
      const auditObservations = allObservations.filter((item) => item.auditId === audit.id);
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
      const W = pdf.internal.pageSize.getWidth();
      const H = pdf.internal.pageSize.getHeight();
      const M = 14;
      const CW = W - M * 2;
      const NAVY: [number, number, number] = [22, 39, 61];
      const GREEN: [number, number, number] = [112, 170, 83];
      const PALE: [number, number, number] = [241, 244, 247];
      const GRID: [number, number, number] = [214, 219, 224];
      const TEXT: [number, number, number] = [48, 57, 67];
      let y = 18;
      let pageNo = 1;
      const plantName = audit.plantName || current.plants.find((p) => p.id === audit.plantId)?.name || "Not specified";
      const allCheckpoints = execution.flatMap((equipment) => equipment.checkpoints.map((checkpoint) => ({ equipment, checkpoint })));
      const count = (result: string) => allCheckpoints.filter((item) => item.checkpoint.result === result).length;
      const complied = count("C");
      const notComplied = count("NC");
      const na = count("NA");
      const answered = complied + notComplied + na + count("OFI");
      const applicable = complied + notComplied;
      const compliance = applicable ? (complied / applicable) * 100 : 0;
      const severityWeights: Record<string, number> = { critical: 5.0, major: 3.0, minor: 1.0 };
      const wOk = complied * 1.0;
      let wNc = 0.0;
      for (const item of allCheckpoints) {
        if (item.checkpoint.result === "NC") {
          const linkedObs = auditObservations.find((o) => o.checkpointId === item.checkpoint.id);
          const sev = String(linkedObs?.severity ?? "").trim().toLowerCase();
          wNc += severityWeights[sev] ?? severityWeights.major;
        }
      }
      const denom = wOk + wNc;
      const auditScore = denom > 0 ? Math.round((wOk * 100.0 / denom) * 10) / 10 : 0;
      const openCount = auditObservations.filter((o) => o.status !== "closed").length;
      const closedCount = auditObservations.length - openCount;
      const rating = !applicable ? "Not Rated" : auditScore >= 90 ? "Excellent" : auditScore >= 75 ? "Good" : auditScore >= 60 ? "Needs Improvement" : "Poor";

      const drawPageFrame = () => {
        pdf.setDrawColor(...GRID);
        pdf.setLineWidth(0.25);
        pdf.line(M, 11, W - M, 11);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(8);
        pdf.setTextColor(...GREEN);
        pdf.text("CleanMax", M, 8);
        pdf.setFont("helvetica", "normal");
        pdf.setTextColor(115, 122, 130);
        pdf.text(`Audit Report | ${audit.id.slice(0, 18)}`, W - M, 8, { align: "right" });
        pdf.line(M, H - 11, W - M, H - 11);
        pdf.setFontSize(7);
        pdf.text("CleanMax Solar Audit Platform | Confidential", M, H - 6);
        pdf.text(`Page ${pageNo}`, W - M, H - 6, { align: "right" });
      };
      drawPageFrame();
      const newPage = () => { pdf.addPage(); pageNo++; drawPageFrame(); y = 19; };
      const ensure = (height: number) => { if (y + height > H - 16) newPage(); };
      const text = (value: string, x: number, yy: number, maxWidth: number, size = 8, bold = false, color: [number, number, number] = TEXT) => {
        pdf.setFont("helvetica", bold ? "bold" : "normal");
        pdf.setFontSize(size);
        pdf.setTextColor(...color);
        const lines = pdf.splitTextToSize(value || "—", maxWidth);
        pdf.text(lines, x, yy);
        return lines.length * (size * 0.43) + 1.5;
      };
      const section = (title: string, subtitle = "") => {
        ensure(subtitle ? 15 : 11);
        y += 3;
        pdf.setFont("helvetica", "bold"); pdf.setFontSize(13); pdf.setTextColor(...NAVY);
        pdf.text(title, M, y);
        y += 3;
        pdf.setDrawColor(...GREEN); pdf.setLineWidth(0.65); pdf.line(M, y, W - M, y);
        y += 4.5;
        if (subtitle) { y += text(subtitle, M, y, CW, 8, false, [105, 112, 121]); }
      };
      const drawTable = (
        headers: string[],
        widths: number[],
        rows: Array<{ cells: string[]; boldCols?: number[]; colorCols?: Record<number, [number, number, number]> }>,
        fontSize = 7,
      ) => {
        const lineStep = fontSize * 0.44;
        const padX = 2;
        const padTop = 3.8;
        const padBottom = 2;
        const headerH = 7.5;
        const drawHeader = () => {
          ensure(headerH + 8);
          let hx = M;
          headers.forEach((h, i) => {
            pdf.setFillColor(...NAVY);
            pdf.rect(hx, y, widths[i], headerH, "F");
            pdf.setFont("helvetica", "bold");
            pdf.setFontSize(fontSize);
            pdf.setTextColor(255, 255, 255);
            const hLines = pdf.splitTextToSize(h, widths[i] - padX * 2);
            pdf.text(hLines, hx + padX, y + 4.8);
            hx += widths[i];
          });
          y += headerH;
        };
        drawHeader();
        rows.forEach((row, rowIndex) => {
          const wrapped = row.cells.map((val, colIdx) => pdf.splitTextToSize(val || "—", Math.max(4, widths[colIdx] - padX * 2)));
          const maxLines = Math.max(1, ...wrapped.map((lines) => lines.length));
          const rowH = Math.max(7, maxLines * lineStep + padTop + padBottom - 1.5);
          if (y + rowH > H - 16) {
            newPage();
            drawHeader();
          }
          let cx = M;
          wrapped.forEach((lines, colIdx) => {
            if (rowIndex % 2 === 0) {
              pdf.setFillColor(...PALE);
              pdf.rect(cx, y, widths[colIdx], rowH, "F");
            }
            pdf.setDrawColor(...GRID);
            pdf.rect(cx, y, widths[colIdx], rowH);
            const isBold = Boolean(row.boldCols?.includes(colIdx));
            const colColor = row.colorCols?.[colIdx] ?? TEXT;
            pdf.setFont("helvetica", isBold ? "bold" : "normal");
            pdf.setFontSize(fontSize);
            pdf.setTextColor(...colColor);
            pdf.text(lines, cx + padX, y + padTop);
            cx += widths[colIdx];
          });
          y += rowH;
        });
      };
      const tableRow = (label: string, value: string, index: number, labelWidth = 48) => {
        const valLines = pdf.splitTextToSize(value || "N/A", CW - labelWidth - 5);
        const h = Math.max(7.2, valLines.length * 3.8 + 3);
        ensure(h);
        if (index % 2 === 0) { pdf.setFillColor(...PALE); pdf.rect(M, y, CW, h, "F"); }
        pdf.setDrawColor(...GRID); pdf.rect(M, y, CW, h);
        pdf.line(M + labelWidth, y, M + labelWidth, y + h);
        text(label, M + 2.2, y + 4.5, labelWidth - 4.4, 7.5, true, [105, 112, 121]);
        text(value || "N/A", M + labelWidth + 2.2, y + 4.5, CW - labelWidth - 4.4, 8);
        y += h;
      };
      const headerBand = (title: string, right = "") => {
        ensure(10);
        pdf.setFillColor(...NAVY); pdf.rect(M, y, CW, 7.5, "F");
        text(title, M + 2.5, y + 5, CW - 28, 8.8, true, [255, 255, 255]);
        if (right) text(right, W - M - 22, y + 5, 19, 8.8, true, [255, 255, 255]);
        y += 8.5;
      };
      type PdfPhotoEntry = {
        src: string;
        kind: string;
        caption: string;
        remark?: string;
        latitude?: number | null;
        longitude?: number | null;
      };
      const getImageDims = (dataUrl: string) => new Promise<{ w: number; h: number }>((resolve) => {
        const img = new window.Image();
        img.onload = () => resolve({ w: img.naturalWidth || 4, h: img.naturalHeight || 3 });
        img.onerror = () => resolve({ w: 4, h: 3 });
        img.src = dataUrl;
      });
      const renderPhotoGrid = async (entries: PdfPhotoEntry[]) => {
        const valid = entries.filter((item) => item.src && item.src.startsWith("data:image/"));
        if (!valid.length) return;
        const gap = 4;
        const boxW = (CW - gap) / 2;
        const maxImgW = boxW - 4;
        const maxImgH = 42;
        const dimsList = await Promise.all(valid.map((item) => getImageDims(item.src)));

        for (let i = 0; i < valid.length; i += 2) {
          const pair = valid.slice(i, i + 2);
          const pairDims = dimsList.slice(i, i + 2);
          const cardMetrics = pair.map((item, j) => {
            const capLines = pdf.splitTextToSize(item.caption || "Inspection photo", boxW - 4);
            const remLines = item.remark ? pdf.splitTextToSize(`Remark: ${item.remark}`, boxW - 4) : [];
            const hasGps = typeof item.latitude === "number" && typeof item.longitude === "number";
            const imgScale = Math.min(maxImgW / pairDims[j].w, maxImgH / pairDims[j].h);
            const drawW = pairDims[j].w * imgScale;
            const drawH = pairDims[j].h * imgScale;
            const textH =
              4.2 + // kind heading
              capLines.length * 3.0 + 1.2 +
              (remLines.length ? remLines.length * 3.2 + 1.4 : 0) +
              (hasGps ? 4.2 : 0);
            const cardH = 3 + maxImgH + 3.5 + textH + 2.5;
            return { capLines, remLines, hasGps, drawW, drawH, cardH };
          });
          const rowH = Math.max(...cardMetrics.map((m) => m.cardH));
          ensure(rowH + 3);
          const rowTop = y;
          pair.forEach((item, j) => {
            const m = cardMetrics[j];
            const cardX = M + j * (boxW + gap);
            pdf.setDrawColor(...GRID);
            pdf.setFillColor(255, 255, 255);
            pdf.rect(cardX, rowTop, boxW, rowH, "FD");
            try {
              const fmt = item.src.startsWith("data:image/png") ? "PNG" : "JPEG";
              const imgX = cardX + 2 + (maxImgW - m.drawW) / 2;
              const imgY = rowTop + 2.5 + (maxImgH - m.drawH) / 2;
              pdf.addImage(item.src, fmt, imgX, imgY, m.drawW, m.drawH, undefined, "FAST");
            } catch (error) {
              console.warn("Skipping a photo that could not be embedded in the PDF", error);
            }
            let ty = rowTop + 2.5 + maxImgH + 4.2;
            pdf.setFont("helvetica", "bold"); pdf.setFontSize(7.2); pdf.setTextColor(...NAVY);
            pdf.text(item.kind, cardX + 2, ty);
            ty += 3.8;
            pdf.setFont("helvetica", "normal"); pdf.setFontSize(6.5); pdf.setTextColor(...TEXT);
            pdf.text(m.capLines, cardX + 2, ty);
            ty += m.capLines.length * 3.0 + 1.2;
            if (m.remLines.length) {
              pdf.setFont("helvetica", "bold"); pdf.setFontSize(6.8); pdf.setTextColor(...NAVY);
              pdf.text(m.remLines, cardX + 2, ty);
              ty += m.remLines.length * 3.2 + 1.4;
            }
            if (m.hasGps) {
              const lat = item.latitude as number;
              const lon = item.longitude as number;
              const gpsLabel = `GPS: ${lat.toFixed(5)}, ${lon.toFixed(5)} (Open in Maps)`;
              const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lon.toFixed(6)}`;
              pdf.setFont("helvetica", "bold"); pdf.setFontSize(6.6); pdf.setTextColor(21, 128, 61);
              pdf.textWithLink(gpsLabel, cardX + 2, ty, { url: mapsUrl });
              const lw = pdf.getTextWidth(gpsLabel);
              pdf.setDrawColor(21, 128, 61);
              pdf.line(cardX + 2, ty + 0.6, cardX + 2 + lw, ty + 0.6);
            }
          });
          y = rowTop + rowH + 3;
        }
      };

      // Cover page — branded, clean and intentionally restrained.
      pdf.setFillColor(...NAVY); pdf.rect(M, 20, CW, 62, "F");
      pdf.setFillColor(...GREEN); pdf.rect(M, 79, CW, 3, "F");
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(11); pdf.setTextColor(...GREEN);
      pdf.text("CleanMax", M + 7, 32);
      pdf.setFontSize(8); pdf.setTextColor(225, 231, 238);
      pdf.text("TECHNICAL & OPERATIONAL AUDIT REPORT", W - M - 7, 32, { align: "right" });
      pdf.setFontSize(22); pdf.setTextColor(255, 255, 255);
      pdf.text(["Solar Plant", "O&M Audit Report"], M + 7, 47);
      pdf.setFontSize(13); pdf.setTextColor(...GREEN);
      pdf.text(plantName, M + 7, 64);
      pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); pdf.setTextColor(224, 230, 237);
      pdf.text("Field Inspection & Asset Health Assessment", M + 7, 73);
      y = 95;
      const coverRows = [
        ["Audit No.", audit.id], ["Plant", plantName], ["Site", current.siteName || "N/A"],
        ["Location", current.siteLocation || "N/A"], ["Audit Date / Time", audit.auditDate || "N/A"],
        ["Auditor", audit.auditor || "N/A"], ["Audit Type", audit.auditType || "N/A"],
        ["Status", audit.status.replace("_", " ").toUpperCase()], ["Generated", new Date().toLocaleString()]
      ];
      coverRows.forEach((r, i) => tableRow(r[0], r[1], i));
      y += 7;
      text("This report consolidates field observations, equipment-level inspection results, compliance scoring and corrective actions recorded during the audit.", M, y, CW, 8);
      newPage();

      section("01  Executive Summary", "Management-level view of audit coverage, compliance and open actions.");
      const metrics = [
        [String(execution.length), "EQUIPMENT GROUPS"], [String(answered), "CHECKPOINTS ANSWERED"],
        [String(complied), "COMPLIED"], [String(notComplied), "NOT COMPLIED"], [String(auditObservations.length), "OBSERVATIONS"]
      ];
      const gap = 1;
      const mw = (CW - gap * 4) / 5;
      metrics.forEach((m, i) => {
        const x = M + i * (mw + gap);
        pdf.setFillColor(...PALE); pdf.setDrawColor(...GRID); pdf.rect(x, y, mw, 19, "FD");
        pdf.setFont("helvetica", "bold"); pdf.setFontSize(15); pdf.setTextColor(...NAVY); pdf.text(m[0], x + mw / 2, y + 8, { align: "center" });
        pdf.setFontSize(5.7); pdf.setTextColor(95, 104, 114); pdf.text(pdf.splitTextToSize(m[1], mw - 2), x + mw / 2, y + 13, { align: "center" });
      });
      y += 24;
      const scoreRow = (label: string, value: number, suffix = "%") => {
        ensure(10);
        text(label, M, y, 72, 7.5, true, [105, 112, 121]);
        const bx = M + 74, bw = CW - 98;
        pdf.setFillColor(241, 243, 245); pdf.rect(bx, y - 3.5, bw, 3.3, "F");
        pdf.setFillColor(value >= 75 ? 83 : 211, value >= 75 ? 132 : 157, value >= 75 ? 65 : 42);
        pdf.rect(bx, y - 3.5, bw * Math.max(0, Math.min(100, value)) / 100, 3.3, "F");
        text(`${value.toFixed(1)}${suffix}`, W - M - 1 - 20, y, 20, 9, true, GREEN);
        y += 7;
      };
      scoreRow("AUDIT SCORE (SEVERITY-WEIGHTED)", auditScore);
      scoreRow("COMPLIANCE (COMPLIED / APPLICABLE)", compliance);
      ensure(8); text("SITE RATING", M, y, 72, 7.5, true, [105, 112, 121]); text(rating, W - M - 1 - 48, y, 48, 9, true, GREEN); y += 8;
      ensure(8); text(`Observations: ${auditObservations.length}     Open / in follow-up: ${openCount}     Closed: ${closedCount}`, M, y, CW, 8, true); y += 7;
      headerBand("Compliance by Equipment Type");
      const colWidths = [CW - 102, 24, 28, 22, 28];
      drawTable(
        ["Equipment Type", "Complied", "Not Complied", "N/A", "Compliance"],
        colWidths,
        execution.map((equipment) => {
          const c = equipment.checkpoints.filter((p) => p.result === "C").length;
          const nc = equipment.checkpoints.filter((p) => p.result === "NC").length;
          const n = equipment.checkpoints.filter((p) => p.result === "NA").length;
          const pct = c + nc ? (c / (c + nc)) * 100 : 0;
          return {
            cells: [equipment.equipmentType || equipment.name, String(c), String(nc), String(n), `${pct.toFixed(1)}%`],
            boldCols: [0],
          };
        }),
        7.2,
      );

      newPage();
      section("02  Plant & Audit Information", "Core identification and site configuration captured for this audit.");
      [
        ["Plant Name", plantName], ["Location", current.siteLocation || "N/A"], ["Audit ID", audit.id],
        ["Audit Date", audit.auditDate || "N/A"], ["Audit Type", audit.auditType || "N/A"],
        ["Auditor", audit.auditor || "N/A"], ["Organization", current.organizationName || "CleanMax"],
        ["Site", current.siteName || "N/A"], ["Status", audit.status.replace("_", " ").toUpperCase()]
      ].forEach((r, i) => tableRow(r[0], r[1], i));

      section("03  Equipment Audit Details", "Checkpoint results by equipment (Complied / Not Complied / N/A).");
      const statusLabel = (r: string) => r === "C" ? "Complied" : r === "NC" ? "Not Complied" : r === "NA" ? "N/A" : r === "OFI" ? "Opportunity for Improvement" : (r || "Not answered");
      for (let ei = 0; ei < execution.length; ei++) {
        const equipment = execution[ei];
        const c = equipment.checkpoints.filter((p) => p.result === "C").length;
        const nc = equipment.checkpoints.filter((p) => p.result === "NC").length;
        const pct = c + nc ? c / (c + nc) * 100 : 0;
        headerBand(`${String(ei + 1).padStart(2, "0")}  ${equipment.name} | ${equipment.equipmentType}`, `${pct.toFixed(0)}%`);
        const widths = [9, CW - 9 - 34 - 46, 34, 46];
        if (!equipment.checkpoints.length) {
          text("No checkpoints saved.", M + 2, y + 3, CW - 4, 8);
          y += 7;
        } else {
          drawTable(
            ["#", "Inspection Point", "Result", "Remarks"],
            widths,
            equipment.checkpoints.map((cp, ci) => {
              const resultColor: [number, number, number] = cp.result === "C" ? [83, 132, 65] : cp.result === "NC" ? [201, 77, 77] : [110, 118, 126];
              return {
                cells: [String(ci + 1), cp.checkpointText || "Checkpoint", statusLabel(cp.result), cp.remarks || "—"],
                boldCols: [2],
                colorCols: { 2: resultColor },
              };
            }),
            7,
          );
        }
        const photos: PdfPhotoEntry[] = equipment.checkpoints.flatMap((cp) => (cp.photos ?? []).map((p) => ({
          src: p.src,
          kind: "Inspection Evidence",
          caption: cp.checkpointText || "Inspection point",
          remark: p.remark,
          latitude: p.latitude,
          longitude: p.longitude,
        })));
        if (photos.length) {
          ensure(10); y += 3; text("Photo Evidence", M, y + 2, CW, 9, true, NAVY); y += 5;
          await renderPhotoGrid(photos);
          y += 2;
        }
        y += 4;
      }

      section("04  Safety Audit", "Site-level safety checkpoints.");
      const safety = execution.filter((e) => /safety/i.test(`${e.name} ${e.equipmentType}`));
      if (!safety.length) { text("No safety checkpoints were answered for this audit.", M, y, CW, 8); y += 6; }
      section("05  Civil / Infrastructure Audit", "Site-level civil and infrastructure checkpoints.");
      const civil = execution.filter((e) => /civil|infrastructure/i.test(`${e.name} ${e.equipmentType}`));
      if (!civil.length) { text("No Civil / Infrastructure checkpoints were answered for this audit.", M, y, CW, 8); y += 6; }

      section("06  Observations & Closure Tracking", "Findings, severity, responsible person, target date and current closure status.");
      const obsWidths = [8, 38, 46, 22, 24, 22, CW - 160];
      if (!auditObservations.length) {
        text("No observations recorded for this audit.", M, y + 3, CW, 8);
        y += 7;
      } else {
        drawTable(
          ["#", "Equipment / Checkpoint", "Observation & Remarks", "Severity", "Responsible", "Target Date", "Status"],
          obsWidths,
          auditObservations.map((o, i) => ({
            cells: [
              String(i + 1),
              `${o.title || "Finding"}\n${o.checkpointText || ""}`,
              `${o.description || "(no observation text)"}${o.actionText ? `\nAction taken: ${o.actionText}` : ""}`,
              o.severity || "Not set",
              o.responsiblePerson || "N/A",
              o.targetDate || "N/A",
              (o.status || "Open").replaceAll("_", " "),
            ],
            boldCols: [1],
          })),
          6.5,
        );
        y += 3;
        const obsPhotos: PdfPhotoEntry[] = auditObservations.flatMap((o) => [
          ...(o.photos ?? []).map((p) => ({
            src: p.src,
            kind: "Inspection Evidence",
            caption: o.checkpointText || o.title || "Finding photo",
            remark: p.remark,
            latitude: p.latitude,
            longitude: p.longitude,
          })),
          ...(o.actionPhotos ?? []).map((p) => ({
            src: p.src,
            kind: "Action-Taken Evidence",
            caption: o.actionText || o.title || "Closure photo",
            remark: p.remark,
            latitude: p.latitude,
            longitude: p.longitude,
          })),
        ]);
        if (obsPhotos.length) {
          ensure(10); text("Observation Photo Evidence", M, y + 2, CW, 9, true, NAVY); y += 5;
          await renderPhotoGrid(obsPhotos);
        }
      }

      section("07  Audit Sign-Off", "Final acknowledgement of the audit and its findings.");
      ensure(28);
      const half = CW / 2;
      pdf.setFillColor(...PALE); pdf.setDrawColor(...GRID); pdf.rect(M, y - 4, half, 8, "FD"); pdf.rect(M + half, y - 4, half, 8, "FD");
      text("AUDITOR", M + 2, y, half - 4, 7, true, [105, 112, 121]);
      text("AUDITEE / PLANT REPRESENTATIVE", M + half + 2, y, half - 4, 7, true, [105, 112, 121]); y += 9;
      pdf.rect(M, y - 4, half, 12); pdf.rect(M + half, y - 4, half, 12);
      text(audit.auditor || "N/A", M + 2, y, half - 4, 8); text("N/A", M + half + 2, y, half - 4, 8); y += 18;
      text("Signature: __________________________", M + 2, y, half - 4, 7);
      text("Signature: __________________________", M + half + 2, y, half - 4, 7); y += 8;
      text("Date: ______________________________", M + 2, y, half - 4, 7);
      text("Date: ______________________________", M + half + 2, y, half - 4, 7); y += 12;
      ensure(24);
      pdf.setFillColor(235, 245, 229); pdf.setDrawColor(...GREEN); pdf.rect(M, y - 4, CW, 23, "FD");
      text("Audit Conclusion", M + 4, y + 1, CW - 8, 9, true, NAVY);
      text(`The audit recorded ${answered} checkpoint responses: ${complied} Complied and ${notComplied} Not Complied. Compliance is ${compliance.toFixed(1)}%, the local checkpoint pass rate is ${auditScore.toFixed(1)}% and the site rating is ${rating}. ${auditObservations.length} observation(s) were raised, of which ${openCount} remain open or in follow-up.`, M + 4, y + 7, CW - 8, 7.2);
      const safeName = (audit.title || "audit-report").replace(/[^a-z0-9-_]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "audit-report";
      const filename = `${safeName}_${audit.auditDate || new Date().toISOString().slice(0, 10)}.pdf`;
      const base64 = String(pdf.output("datauristring")).split(",")[1] ?? "";
      if (base64 && (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()) {
        const saved = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Documents, recursive: true });
        await Share.share({ title: `Audit report: ${audit.title}`, text: `Solar Audit report for ${audit.title}`, url: saved.uri, dialogTitle: "Share or save audit report" });
        setMessage("Corporate-format PDF report generated. Use the share sheet to save or send it.");
      } else {
        pdf.save(filename);
        setMessage("Corporate-format PDF report generated and downloaded.");
      }
    } catch (error) {
      console.error("[Solar Audit] PDF report generation failed:", error);
      setMessage(error instanceof Error ? `Could not generate report: ${error.message}` : "Could not generate the report. Please retry.");
    }
  }

  const hasWorkspace = Boolean(workspace);
  const assignedUser = workspace?.assignedUser;
  const isAdminUser = !assignedUser || ["site_admin", "admin"].includes(String(assignedUser.role ?? "").toLowerCase());
  const allowedServerPlantIds = useMemo(
    () => new Set((assignedUser?.assignedServerPlantIds ?? []).map((id) => String(id))),
    [assignedUser],
  );
  const visiblePlants = useMemo(() => {
    const allPlants = workspace?.plants ?? [];
    if (!assignedUser || isAdminUser) return allPlants;
    return allPlants.filter((plant) => plant.serverPlantId && allowedServerPlantIds.has(String(plant.serverPlantId)));
  }, [workspace, assignedUser, isAdminUser, allowedServerPlantIds]);
  const visibleAudits = useMemo(() => {
    if (!assignedUser || isAdminUser) return audits;
    const plantIds = new Set(visiblePlants.map((p) => p.id));
    const serverIds = new Set(visiblePlants.map((p) => String(p.serverPlantId ?? "")).filter(Boolean));
    return audits.filter((audit) => {
      if (plantIds.has(audit.plantId)) return true;
      if (audit.plantId.startsWith("server-plant:")) {
        const parts = audit.plantId.split(":");
        return parts.length >= 3 && serverIds.has(parts[2]);
      }
      return false;
    });
  }, [audits, assignedUser, isAdminUser, visiblePlants]);
  const visibleObservations = useMemo(() => {
    if (!assignedUser || isAdminUser) return observations;
    const auditIds = new Set(visibleAudits.map((a) => a.id));
    const plantNames = new Set(visiblePlants.map((p) => p.name.trim().toLowerCase()));
    return observations.filter((obs) =>
      auditIds.has(obs.auditId)
      || (obs.plantName ? plantNames.has(obs.plantName.trim().toLowerCase()) : false),
    );
  }, [observations, assignedUser, isAdminUser, visibleAudits, visiblePlants]);
  const plantsCount = visiblePlants.length;
  const navItems: { label: Section; icon: string }[] = [
    { label: "Dashboard", icon: "grid" },
    { label: "Sites & Plants", icon: "site" },
    { label: "Audits", icon: "audit" },
    { label: "Observations", icon: "eye" },
    { label: "Reports", icon: "report" },
    { label: "Settings", icon: "settings" },
  ];

  function addEquipmentPlan() {
    if (!plantEquipmentCategory) {
      setMessage("Choose an equipment category first.");
      return;
    }
    const quantity = Number.parseInt(plantEquipmentQuantity, 10);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) {
      setMessage("Equipment quantity must be between 1 and 500.");
      return;
    }
    setPlantEquipmentPlan((current) => {
      const existing = current.find((item) => item.category === plantEquipmentCategory);
      if (existing) return current.map((item) => item.category === plantEquipmentCategory ? { ...item, quantity: item.quantity + quantity } : item);
      return [...current, { category: plantEquipmentCategory, quantity }];
    });
    setPlantEquipmentCategory("");
    setPlantEquipmentQuantity("1");
  }

  async function addPlant(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || !plantName.trim()) return;
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const equipment: PlantEquipment[] = [];
    for (const plan of plantEquipmentPlan) {
      for (let index = 1; index <= plan.quantity; index += 1) {
        equipment.push({
          id: `${id}-eq-${Math.random().toString(16).slice(2)}-${index}`,
          category: plan.category,
          name: `${plan.category} ${index}`,
        });
      }
    }
    let plant: Plant = {
      id,
      name: plantName.trim(),
      location: plantLocation.trim(),
      capacityMw: plantCapacity.trim(),
      equipment,
    };
    if (serverToken && serverBootstrap?.user?.role && ["admin", "site_admin"].includes(serverBootstrap.user.role.toLowerCase())) {
      try {
        const serverPlant = await createServerPlant(serverBaseUrl, serverToken, {
          name: plant.name,
          location: plant.location,
          capacity_mw: plant.capacityMw ? Number(plant.capacityMw) : null,
        });
        plant = {
          ...plant,
          id: `server-plant:${serverPlant.site_id}:${serverPlant.id}`,
          serverPlantId: serverPlant.id,
          source: "server",
          name: serverPlant.name,
          location: String(serverPlant.location ?? ""),
          capacityMw: String(serverPlant.capacity_mw ?? ""),
        };
        const latestReferenceData = await downloadSiteReferenceData(serverBaseUrl, serverToken, serverPlant.site_id);
        await cacheServerReferenceData(latestReferenceData);
        const merged = await mergeServerPlantsIntoWorkspace(
          { ...workspace, plants: workspace.plants.filter((item) => !item.serverPlantId && item.source !== "server") },
          latestReferenceData,
        );
        // Keep local-only plants while making the backend's returned plant list authoritative.
        const localOnly = workspace.plants.filter((item) => !item.serverPlantId && item.source !== "server");
        const mergedWorkspace = { ...merged, plants: [...localOnly, ...merged.plants.filter((item) => item.serverPlantId)] };
        await saveWorkspace(mergedWorkspace);
        setWorkspace(mergedWorkspace);
        setMessage(`Plant “${serverPlant.name}” saved to the backend and refreshed from the server.`);
      } catch (error) {
        setMessage(error instanceof Error ? `Backend plant creation failed: ${error.message}. No local-only copy was created.` : "Backend plant creation failed. No local-only copy was created.");
        return;
      }
    } else {
      setWorkspace({ ...workspace, plants: [...workspace.plants, plant] });
      setMessage("Plant saved locally. Sign in as a site administrator to create it in the backend.");
    }
    setPlantName("");
    setPlantLocation("");
    setPlantCapacity("");
    setPlantEquipmentPlan([]);
    setPlantEquipmentCategory("");
    setPlantEquipmentQuantity("1");
    setShowPlantForm(false);
  }

  async function addEquipmentToExistingPlant(plantId: string) {
    if (!workspace || !existingEquipmentCategory) { setMessage("Choose an equipment category first."); return; }
    const quantity = Number.parseInt(existingEquipmentQuantity, 10);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 500) { setMessage("Equipment quantity must be between 1 and 500."); return; }
    const plant = workspace.plants.find((item) => item.id === plantId);
    if (!plant) return;
    if (plant.serverPlantId && serverToken) {
      try {
        const siteId = serverBootstrap?.sites?.[0]?.id;
        if (!siteId) throw new Error("The connected server site is unavailable. Sign in again.");
        const reference = await downloadSiteReferenceData(serverBaseUrl, serverToken, siteId);
        const normalizeAssetTypeName = (value: string) => value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        const categoryAliases: Record<string, string[]> = {
          "Inverter Duty Transformer": ["IDT"],
          "LV/Auxillary Panel": ["LT Panel"],
          "LV/Auxiliary Panel": ["LT Panel"],
          "RMU/HT Pannel": ["HT Panel"],
          "WMS": ["Weather Monitoring System"],
          "Housekeeping In DC Field": ["Housekeeping/Vegetation Management In DC Field"],
          "Switch Yard": ["Switchyard"],
          "PTR": ["Power Transformer"],
          "Lightning Arrestor": ["LA and Earthing System"],
          "Safety/ Measuring Tools": ["Safety/ Measuring Tools"],
        };
        const acceptedNames = [existingEquipmentCategory, ...(categoryAliases[existingEquipmentCategory] ?? [])].map(normalizeAssetTypeName);
        const matchingType = reference.data.asset_types.find((item) => acceptedNames.includes(normalizeAssetTypeName(item.name)));
        if (!matchingType) throw new Error(`“${existingEquipmentCategory}” has no matching equipment type configured on the backend yet. The backend checklist types were refreshed; choose a supported category or add this category to the backend checklist taxonomy.`);
        const existingNames = new Set((reference.data.assets || []).filter((item) => String(item.plant_id) === plant.serverPlantId).map((item) => item.name));
        for (let i = 0; i < quantity; i += 1) {
          let suffix = 1; while (existingNames.has(`${existingEquipmentCategory} ${suffix}`)) suffix += 1;
          const name = `${existingEquipmentCategory} ${suffix}`;
          const created = await createServerAsset(serverBaseUrl, serverToken, plant.serverPlantId, { name, asset_type_id: Number(matchingType.id) });
          existingNames.add(created.name);
        }
        const refreshed = await downloadSiteReferenceData(serverBaseUrl, serverToken, siteId);
        await cacheServerReferenceData(refreshed);
        const merged = await mergeServerPlantsIntoWorkspace(workspace, refreshed);
        await saveWorkspace(merged); setWorkspace(merged);
        setMessage(`${quantity} equipment item(s) saved to the backend and reference data refreshed.`);
      } catch (error) {
        setMessage(error instanceof Error ? `Backend equipment save failed: ${error.message}` : "Backend equipment save failed.");
        return;
      }
    } else {
      const updatedPlants = workspace.plants.map((item) => {
        if (item.id !== plantId) return item;
        const equipment = [...(item.equipment ?? [])];
        const existingNames = new Set(equipment.filter((entry) => entry.category === existingEquipmentCategory).map((entry) => entry.name));
        for (let added = 0; added < quantity; added += 1) { let n = 1; while (existingNames.has(`${existingEquipmentCategory} ${n}`)) n += 1; const name = `${existingEquipmentCategory} ${n}`; equipment.push({ id: `${plantId}-eq-${Math.random().toString(16).slice(2)}`, category: existingEquipmentCategory, name }); existingNames.add(name); }
        return { ...item, equipment };
      });
      setWorkspace({ ...workspace, plants: updatedPlants });
      setMessage("Equipment saved to this offline draft only. Sign in as an administrator to save backend equipment.");
    }
    setExistingEquipmentCategory(""); setExistingEquipmentQuantity("1");
  }

  const PLANT_SPEC_FIELDS: Array<[string, string, boolean]> = [
    ["building_name", "Building / plant name", false], ["roof_type", "Roof type", false], ["city", "City", false], ["state", "State", false],
    ["no_of_blocks", "Number of blocks", true], ["dc_capacity", "DC capacity (MWp)", true], ["ac_capacity", "AC capacity (MW)", true],
    ["central_inverter_type", "Central inverter type", false], ["central_inverter_count", "Central inverter count", true],
    ["string_inverter_type", "String inverter type", false], ["string_inverter_count", "String inverter count", true],
    ["scb_count", "SCB count", true], ["mms_type", "MMS type", false], ["mms_count", "MMS count", true],
    ["transformer_type", "Transformer type", false], ["transformer_count", "Transformer count", true],
    ["lt_panel_type", "LT panel type", false], ["lt_panel_count", "LT panel count", true], ["ht_panel_type", "HT panel type", false], ["ht_panel_count", "HT panel count", true],
    ["acdb_count", "ACDB count", true], ["ups_db_battery_count", "UPS/DB battery count", true], ["lightning_protection_count", "Lightning protection count", true],
    ["clamps_connectors_count", "Clamps/connectors count", true], ["dc_earthing", "DC earthing", false], ["ac_earthing", "AC earthing", false],
  ];

  async function editPlantSpecifications(plant: Plant) {
    if (!plant.serverPlantId || !serverToken) { setMessage("Plant specifications can be edited from the APK only for a backend-managed plant while signed in as an administrator."); return; }
    try {
      const specs = await getServerPlantSpecs(serverBaseUrl, serverToken, plant.serverPlantId) as Record<string, unknown>;
      const initial: Record<string, string> = {};
      for (const [key] of PLANT_SPEC_FIELDS) {
        initial[key] = specs[key] == null ? "" : String(specs[key]);
      }
      setSpecPlant(plant);
      setSpecValues(initial);
      setMessage("");
    } catch (error) { setMessage(error instanceof Error ? `Could not load plant specifications: ${error.message}` : "Could not load plant specifications."); }
  }

  async function savePlantSpecificationsForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!specPlant?.serverPlantId || !serverToken || specSaving) return;
    setSpecSaving(true);
    try {
      const updates: Record<string, string | number | null> = {};
      for (const [key, label, numeric] of PLANT_SPEC_FIELDS) {
        const raw = (specValues[key] ?? "").trim();
        if (numeric) {
          if (!raw) updates[key] = null;
          else {
            const n = Number(raw);
            if (!Number.isFinite(n) || n < 0) throw new Error(`${label} must be a non-negative number.`);
            updates[key] = n;
          }
        } else {
          updates[key] = raw || null;
        }
      }
      await saveServerPlantSpecs(serverBaseUrl, serverToken, specPlant.serverPlantId, updates);
      const siteId = serverBootstrap?.sites?.[0]?.id;
      if (siteId) { const refreshed = await downloadSiteReferenceData(serverBaseUrl, serverToken, siteId); await cacheServerReferenceData(refreshed); }
      const savedName = specPlant.name;
      setSpecPlant(null);
      setSpecValues({});
      setMessage(`Specifications for “${savedName}” saved to the backend.`);
    } catch (error) {
      setMessage(error instanceof Error ? `Plant specification save failed: ${error.message}` : "Plant specification save failed.");
    } finally {
      setSpecSaving(false);
    }
  }

  function deletePlant(id: string) {
    if (!workspace) return;
    const plant = workspace.plants.find((item) => item.id === id);
    if (!plant) return;
    if (plant.source === "server" || plant.serverPlantId) {
      setMessage("This plant is managed by the backend. Refresh server reference data to update it; it cannot be deleted from the APK.");
      return;
    }
    const linkedAudits = audits.filter((audit) => audit.plantId === id).length;
    const confirmed = window.confirm(`Delete plant “${plant.name}”? This removes its equipment configuration. ${linkedAudits} existing audit(s) are linked to this plant; their saved results will not be intentionally deleted, but the plant link may be cleared. This action cannot be undone.`);
    if (!confirmed) return;
    setWorkspace({ ...workspace, plants: workspace.plants.filter((item) => item.id !== id) });
    if (configurePlantId === id) setConfigurePlantId("");
    if (auditPlantId === id) setAuditPlantId("");
    setMessage(`Plant “${plant.name}” deleted after confirmation.`);
  }

  async function renamePlantEquipment(plantId: string, equipmentId: string, currentName: string) {
    const plant = workspace?.plants.find((item) => item.id === plantId);
    const nextName = window.prompt("Edit equipment name", currentName)?.trim();
    if (!nextName || !workspace || !plant) return;
    try {
      if (plant.serverPlantId && serverToken) {
        const rawAssetId = equipmentId.startsWith("server-asset:") ? equipmentId.slice("server-asset:".length) : equipmentId;
        await renameServerAsset(serverBaseUrl, serverToken, plant.serverPlantId, rawAssetId, nextName);
        const siteId = serverBootstrap?.sites?.[0]?.id;
        if (siteId) { const ref = await downloadSiteReferenceData(serverBaseUrl, serverToken, siteId); await cacheServerReferenceData(ref); const merged = await mergeServerPlantsIntoWorkspace(workspace, ref); await saveWorkspace(merged); setWorkspace(merged); }
      } else setWorkspace({ ...workspace, plants: workspace.plants.map((p) => p.id !== plantId ? p : { ...p, equipment: (p.equipment ?? []).map((item) => item.id === equipmentId ? { ...item, name: nextName } : item) }) });
      setMessage("Equipment name updated.");
    } catch (error) { setMessage(error instanceof Error ? `Equipment rename failed: ${error.message}` : "Equipment rename failed."); }
  }

  async function removePlantEquipment(plantId: string, equipmentId: string, name: string) {
    const plant = workspace?.plants.find((item) => item.id === plantId);
    if (!workspace || !plant || !window.confirm(`Remove “${name}” from this plant's registered equipment? Existing audit records will remain unchanged.`)) return;
    try {
      if (plant.serverPlantId && serverToken) {
        const rawAssetId = equipmentId.startsWith("server-asset:") ? equipmentId.slice("server-asset:".length) : equipmentId;
        await deleteServerAsset(serverBaseUrl, serverToken, plant.serverPlantId, rawAssetId);
        const siteId = serverBootstrap?.sites?.[0]?.id;
        if (siteId) { const ref = await downloadSiteReferenceData(serverBaseUrl, serverToken, siteId); await cacheServerReferenceData(ref); const merged = await mergeServerPlantsIntoWorkspace(workspace, ref); await saveWorkspace(merged); setWorkspace(merged); }
      } else setWorkspace({ ...workspace, plants: workspace.plants.map((p) => p.id !== plantId ? p : { ...p, equipment: (p.equipment ?? []).filter((item) => item.id !== equipmentId) }) });
      setMessage(`Equipment “${name}” removed from plant inventory.`);
    } catch (error) { setMessage(error instanceof Error ? `Equipment removal failed: ${error.message}` : "Equipment removal failed."); }
  }

  async function handleCreateAudit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace || !auditPlantId || !auditTitle.trim() || !auditAuditor.trim() || !auditDate) return;
    try {
      const audit = await createAudit({
        plantId: auditPlantId,
        auditType,
        title: auditTitle.trim(),
        auditDate,
        auditor: auditAuditor.trim(),
      });
      const refreshed = await loadAudits();
      setAudits(refreshed);
      setAuditTitle("");
      setAuditAuditor("");
      setAuditDate(new Date().toISOString().slice(0, 10));
      setShowAuditForm(false);
      setMessage(`Draft ${audit.auditType} audit saved on this device.`);
      if (continueAfterCreate) { setContinueAfterCreate(false); await openAudit(audit); }
    } catch (error) {
      console.error("[Solar Audit] Audit create failed:", error);
      setMessage(error instanceof Error ? error.message : "Could not save the audit. Please retry.");
    }
  }

  async function resolveSiteSectionChecklist(sectionType: "Safety" | "Civil"): Promise<string[]> {
    try {
      const cached = await loadCachedServerReferenceData();
      const serverQuestions: any[] = Array.isArray(cached?.data?.checklist?.questions)
        ? cached.data.checklist.questions
        : [];
      const norm = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
      const targetType = sectionType === "Safety" ? "Site Safety" : "Civil / Infrastructure";
      const serverMatches = serverQuestions
        .filter((question) => norm(question.asset_type_name) === norm(targetType))
        .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
        .map((question) => String(question.text ?? "").trim())
        .filter(Boolean);
      if (serverMatches.length) return [...new Set(serverMatches)];
    } catch {
      // Fall back to canonical offline checklist below.
    }
    return sectionType === "Safety" ? SAFETY_CHECKLIST : CIVIL_CHECKLIST;
  }

  async function openAudit(audit: LocalAudit) {
    try {
      let items = await loadAuditExecution(audit.id);
      // Safety and Civil are site-level audits: create their checklist automatically, without equipment selection.
      if (items.length === 0 && audit.status !== "submitted" && (audit.auditType === "Safety" || audit.auditType === "Civil")) {
        const category = audit.auditType === "Safety" ? "Safety checklist" : "Civil checklist";
        const checklist = await resolveSiteSectionChecklist(audit.auditType);
        const siteItem = await addAuditEquipment(audit.id, `${audit.auditType} Site Checklist`, category);
        const checkpoints: AuditCheckpoint[] = [];
        for (const text of checklist) checkpoints.push(await addAuditCheckpoint(audit.id, siteItem.id, text));
        items = [{ ...siteItem, checkpoints }];
      }
      if (audit.status === "submitted") {
        setActiveAudit(null);
        setSummaryAudit(audit);
        setExecutionEquipment(items);
        setSelectedEquipmentId(items.length ? items[0].id : "");
        setSection("Audits");
        setMessage("");
        return;
      }
      setSummaryAudit(null);
      setActiveAudit(audit);
      setExecutionEquipment(items);
      setSelectedEquipmentId(items.length ? items[0].id : "");
      setEquipmentName("");
      setEquipmentType("");
      setSection("Audits");
      setMessage("");
    } catch (error) {
      console.error("[Solar Audit] Audit execution load failed:", error);
      setMessage("Could not open this audit. Your saved data has been preserved.");
    } finally {

    }
  }

  async function switchAuditType(nextType: AuditType) {
    if (!activeAudit || activeAudit.status === "submitted" || activeAudit.auditType === nextType) return;
    if (!window.confirm(`Switch this audit to ${nextType}? Existing equipment and checkpoint results will remain saved.`)) return;
    try {
      await updateAuditType(activeAudit.id, nextType);
      const refreshed = await loadAudits();
      setAudits(refreshed);
      const updatedAudit = refreshed.find((item) => item.id === activeAudit.id) ?? { ...activeAudit, auditType: nextType };
      setActiveAudit(updatedAudit);
      setEquipmentType("");
      setEquipmentName("");

      // Safety and Civil are site-level audits: create/load their checklist immediately on switch.
      if (nextType === "Safety" || nextType === "Civil") {
        const category = nextType === "Safety" ? "Safety checklist" : "Civil checklist";
        const checklist = await resolveSiteSectionChecklist(nextType);
        let items = await loadAuditExecution(activeAudit.id);
        let siteItem = items.find((item) => item.equipmentType === category || item.name === `${nextType} Site Checklist`);
        if (!siteItem) {
          siteItem = await addAuditEquipment(activeAudit.id, `${nextType} Site Checklist`, category);
          const checkpoints: AuditCheckpoint[] = [];
          for (const text of checklist) checkpoints.push(await addAuditCheckpoint(activeAudit.id, siteItem.id, text));
          siteItem = { ...siteItem, checkpoints };
          items = [...items, siteItem];
        } else if (siteItem.checkpoints.length === 0) {
          const checkpoints: AuditCheckpoint[] = [];
          for (const text of checklist) checkpoints.push(await addAuditCheckpoint(activeAudit.id, siteItem.id, text));
          siteItem = { ...siteItem, checkpoints };
          items = items.map((item) => item.id === siteItem!.id ? siteItem! : item);
        }
        setExecutionEquipment(items);
        setSelectedEquipmentId(siteItem.id);
      } else {
        const items = await loadAuditExecution(activeAudit.id);
        setExecutionEquipment(items);
        setSelectedEquipmentId("");
      }
      setMessage(`${nextType} checklist loaded. Existing results were retained.`);
    } catch (error) {
      console.error("[Solar Audit] Audit type switch failed:", error);
      setMessage(error instanceof Error ? error.message : "Could not switch audit section.");
    }
  }

  async function handleAddEquipment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeAudit || !equipmentName.trim() || !equipmentType) return;
    try {
      const item = await addAuditEquipment(activeAudit.id, equipmentName, equipmentType);
      let checkpointTexts: string[] = [];
      // Prefer the signed-in site's backend checklist as the source of truth.
      // The same exact question text is used by manifest sync to resolve server question IDs.
      try {
        const cached = await loadCachedServerReferenceData();
        const serverQuestions: any[] = Array.isArray(cached?.data?.checklist?.questions)
          ? cached.data.checklist.questions
          : [];
        const norm = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
        const targetType = activeAudit.auditType === "Safety"
          ? "Site Safety"
          : activeAudit.auditType === "Civil"
            ? "Civil / Infrastructure"
            : equipmentType;
        const serverMatches = serverQuestions
          .filter((question) => norm(question.asset_type_name) === norm(targetType))
          .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
          .map((question) => String(question.text ?? "").trim())
          .filter(Boolean);
        if (serverMatches.length) checkpointTexts = [...new Set(serverMatches)];
      } catch (error) {
        console.warn("[Solar Audit] Cached backend checklist unavailable; using local fallback.", error);
      }
      // Offline-first fallback only when server checklist data has not been cached
      // or the backend has no questions for this category.
      if (!checkpointTexts.length && activeAudit.auditType === "Technical") {
        checkpointTexts = TECHNICAL_CHECKLISTS[equipmentType] ?? [];
      } else if (!checkpointTexts.length && activeAudit.auditType === "Safety" && equipmentType === "Safety checklist") {
        checkpointTexts = SAFETY_CHECKLIST;
      } else if (!checkpointTexts.length && activeAudit.auditType === "Civil" && equipmentType === "Civil checklist") {
        checkpointTexts = CIVIL_CHECKLIST;
      }
      const createdCheckpoints: AuditCheckpoint[] = [];
      for (const text of checkpointTexts) {
        createdCheckpoints.push(await addAuditCheckpoint(activeAudit.id, item.id, text));
      }
      const itemWithCheckpoints = { ...item, checkpoints: createdCheckpoints };
      setExecutionEquipment((current) => [...current, itemWithCheckpoints]);
      setSelectedEquipmentId(item.id);
      setActiveAudit({ ...activeAudit, status: "in_progress", updatedAt: new Date().toISOString() });
      setEquipmentName("");
      setEquipmentType("");
      const refreshed = await loadAudits();
      setAudits(refreshed);
      setMessage(checkpointTexts.length
        ? `Equipment saved with ${checkpointTexts.length} predefined checkpoints.`
        : "Equipment saved.");
    } catch (error) {
      console.error("[Solar Audit] Equipment save failed:", error);
      setMessage(error instanceof Error ? error.message : "Could not save equipment.");
    }
  }

  async function handleCheckpointChange(equipmentId: string, checkpoint: AuditCheckpoint, changes: Partial<AuditCheckpoint>) {
    if (!activeAudit) return;
    const updated = { ...checkpoint, ...changes };
    setExecutionEquipment((current) => current.map((eq) => eq.id === equipmentId
      ? { ...eq, checkpoints: eq.checkpoints.map((cp) => cp.id === checkpoint.id ? updated : cp) }
      : eq));
    try {
      await updateAuditCheckpoint(activeAudit.id, updated);
      setMessage("Checkpoint saved locally.");
    } catch (error) {
      console.error("[Solar Audit] Checkpoint save failed:", error);
      setMessage("Checkpoint could not be saved. Please retry.");
    }
  }

  async function takeCheckpointPhoto(equipmentId: string, checkpoint: AuditCheckpoint) {
    if (!activeAudit || activeAudit.status === "submitted") return;
    try {
      const photo = await Camera.getPhoto({
        quality: 85,
        width: 1600,
        height: 1600,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Camera,
        direction: CameraDirection.Rear,
        correctOrientation: true,
        saveToGallery: false,
      });
      if (!photo.dataUrl) throw new Error("The camera did not return an image.");
      const response = await fetch(photo.dataUrl);
      const blob = await response.blob();
      const file = new File([blob], `inspection-${Date.now()}.jpg`, { type: blob.type || "image/jpeg" });
      await handleCheckpointPhotos(equipmentId, checkpoint, [file]);
    } catch (error) {
      // Closing the native camera is not an error the user needs to be warned about.
      const message = error instanceof Error ? error.message : String(error);
      if (!/cancel|cancelled|canceled/i.test(message)) {
        console.error("[Solar Audit] Native camera failed:", error);
        setMessage("Could not open the camera. Check camera permission and try again.");
      }
    }
  }

  async function handleCheckpointPhotos(equipmentId: string, checkpoint: AuditCheckpoint, files: FileList | File[] | null) {
    if (!activeAudit || !files?.length) return;
    if (activeAudit.status === "submitted") return;
    try {
      const currentPhotos = checkpoint.photos ?? [];
      const [location, dataUrls] = await Promise.all([
        captureCurrentLocation(),
        Promise.all(Array.from(files).map(photoFileToDataUrl)),
      ]);
      const capturedAt = new Date().toISOString();
      const incoming: PhotoItem[] = dataUrls.map((src) => ({
        src,
        remark: "",
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null,
        accuracy: location?.accuracy ?? null,
        capturedAt,
      }));
      const updated = { ...checkpoint, photos: [...currentPhotos, ...incoming] };
      await updateAuditCheckpoint(activeAudit.id, updated);
      setExecutionEquipment((current) => current.map((eq) => eq.id === equipmentId
        ? { ...eq, checkpoints: eq.checkpoints.map((cp) => cp.id === checkpoint.id ? updated : cp) }
        : eq));
      setMessage(`${incoming.length} photo${incoming.length === 1 ? "" : "s"} saved${location ? ` with GPS (${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)})` : " on this device"}.`);
    } catch (error) {
      console.error("[Solar Audit] Photo capture/save failed:", error);
      setMessage("Photo could not be saved. Please try again with a smaller photo.");
    }
  }

  async function updateCheckpointPhotoRemark(equipmentId: string, checkpoint: AuditCheckpoint, photoIndex: number, remark: string) {
    if (!activeAudit || activeAudit.status === "submitted") return;
    const updated = {
      ...checkpoint,
      photos: (checkpoint.photos ?? []).map((p, idx) => idx === photoIndex ? { ...p, remark } : p),
    };
    setExecutionEquipment((current) => current.map((eq) => eq.id === equipmentId
      ? { ...eq, checkpoints: eq.checkpoints.map((cp) => cp.id === checkpoint.id ? updated : cp) }
      : eq));
    try {
      await updateAuditCheckpoint(activeAudit.id, updated);
    } catch (error) {
      console.error("[Solar Audit] Photo remark save failed:", error);
    }
  }

  async function removeCheckpointPhoto(equipmentId: string, checkpoint: AuditCheckpoint, photoIndex: number) {
    if (!activeAudit || activeAudit.status === "submitted") return;
    const updated = { ...checkpoint, photos: (checkpoint.photos ?? []).filter((_, index) => index !== photoIndex) };
    try {
      await updateAuditCheckpoint(activeAudit.id, updated);
      setExecutionEquipment((current) => current.map((eq) => eq.id === equipmentId
        ? { ...eq, checkpoints: eq.checkpoints.map((cp) => cp.id === checkpoint.id ? updated : cp) }
        : eq));
      setMessage("Photo removed.");
    } catch (error) {
      console.error("[Solar Audit] Photo removal failed:", error);
      setMessage("Photo could not be removed. Please retry.");
    }
  }

  async function submitAudit() {
    if (!activeAudit) return;
    if (!window.confirm("Submit this audit? NC and OFI checkpoints will be added to Observations for follow-up.")) return;
    try {
      const existing = await loadObservations();
      let created = 0;
      for (const equipment of executionEquipment) {
        for (const checkpoint of equipment.checkpoints) {
          if (checkpoint.result !== "NC" && checkpoint.result !== "OFI") continue;
          const duplicate = existing.some((o) => o.auditId === activeAudit.id && (o.checkpointId === checkpoint.id || normalizeObservationText(o.checkpointText || o.title) === normalizeObservationText(checkpoint.checkpointText)) && o.findingType === checkpoint.result);
          if (duplicate) continue;
          await createObservation({
            auditId: activeAudit.id,
            checkpointId: checkpoint.id,
            findingType: checkpoint.result as FindingType,
            title: checkpoint.checkpointText,
            description: checkpoint.remarks || "",
            severity: "",
            responsiblePerson: "",
            actionText: "",
            targetDate: "",
          });
          created++;
        }
      }
      if (serverToken) {
        await syncOneAuditManifest(activeAudit, { throwOnFailure: true });
        await completeServerAudit(serverBaseUrl, serverToken, activeAudit.id);
        await refreshServerObservations(activeAudit.id);
      }
      await markAuditSubmitted(activeAudit.id);
      const refreshedAudits = await loadAudits();
      setAudits(refreshedAudits);
      const submitted = refreshedAudits.find((a) => a.id === activeAudit.id) ?? { ...activeAudit, status: "submitted" as const };
      setActiveAudit(null);
      setSummaryAudit(submitted);
      setObservations(await loadObservations());
      setMessage(`Audit submitted and locked. ${created} observation(s) created from NC/OFI checkpoints.`);
    } catch (error) {
      console.error("[Solar Audit] Audit submission failed:", error);
      const reason = error instanceof Error ? error.message : "Unexpected error";
      if (/expired|invalid access token|unauthorized|401/i.test(reason)) {
        setServerToken("");
        setServerBootstrap(null);
      }
      setMessage(`Could not submit the audit: ${reason}. Your saved audit data has been preserved.`);
    }
  }

  async function addObservationActionPhoto(file: File) {
    try {
      const [location, src] = await Promise.all([captureCurrentLocation(), photoFileToDataUrl(file)]);
      const item: PhotoItem = {
        src,
        remark: "",
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null,
        accuracy: location?.accuracy ?? null,
        capturedAt: new Date().toISOString(),
      };
      setObservationActionPhotos((current) => [...current, item]);
    } catch (error) { console.error("[Solar Audit] Action photo processing failed:", error); setMessage("Action photo could not be processed. Please try another image."); }
  }

  async function takeObservationActionPhoto() {
    try {
      const photo = await Camera.getPhoto({ quality: 85, width: 1600, height: 1600, allowEditing: false, resultType: CameraResultType.DataUrl, source: CameraSource.Camera, direction: CameraDirection.Rear, correctOrientation: true, saveToGallery: false });
      if (!photo.dataUrl) return;
      const response = await fetch(photo.dataUrl); const blob = await response.blob();
      await addObservationActionPhoto(new File([blob], `action-${Date.now()}.jpg`, { type: blob.type || "image/jpeg" }));
    } catch (error) { const msg = error instanceof Error ? error.message : String(error); if (!/cancel|cancelled|canceled/i.test(msg)) { console.error("[Solar Audit] Action camera failed:", error); setMessage("Could not open the camera. Check camera permission and try again."); } }
  }


  function parseUtcMs(value?: string | null): number {
    if (!value) return 0;
    const trimmed = String(value).trim();
    if (!trimmed) return 0;
    const normalized = /[zZ]|[+-]\d{2}:\d{2}$/.test(trimmed) ? trimmed : `${trimmed}Z`;
    const ms = Date.parse(normalized);
    return Number.isFinite(ms) ? ms : 0;
  }

  async function refreshServerObservations(auditId?: string, options?: { forcePushObservationIds?: string[] }) {
    if (!serverToken) {
      setMessage("Sign in to the native API before synchronizing observations. Local observations are preserved.");
      return;
    }
    try {
      const serverItems = await fetchServerObservations(serverBaseUrl, serverToken, auditId);
      let localItems = await loadObservations();
      let linked = 0;
      let pending = 0;
      for (const serverItem of serverItems) {
        const serverFindingType: FindingType =
          serverItem.finding_type === "OFI" || String(serverItem.response_status || "").toLowerCase() === "ofi"
            ? "OFI"
            : "NC";

        // 1. Primary match by serverObservationId
        let candidates = localItems.filter(item => item.serverObservationId === serverItem.id);

        // 2. Fallback match by audit + checkpoint text (using checkpointText or title if checkpoint_id was null)
        if (candidates.length === 0) {
          const sameAuditAndCheckpoint = (item: LocalObservation) =>
            item.auditId === serverItem.audit_id &&
            normalizeObservationText(item.checkpointText || item.title) === normalizeObservationText(serverItem.checkpoint_text);
          candidates = localItems.filter(sameAuditAndCheckpoint);
          const exactEquipment = candidates.filter(item => normalizeObservationText(item.equipmentName ?? "") === normalizeObservationText(serverItem.equipment_name ?? ""));
          const exactType = candidates.filter(item => normalizeObservationText(item.equipmentType ?? "") === normalizeObservationText(serverItem.equipment_type_name ?? ""));
          if (exactEquipment.length) candidates = exactEquipment;
          else if (exactType.length) candidates = exactType;
          const exactFinding = candidates.filter(item => item.findingType === serverFindingType);
          if (exactFinding.length) candidates = exactFinding;
        }

        if (serverItem.status === "withdrawn") {
          for (const item of candidates) {
            await deleteObservation(item.id);
          }
          localItems = await loadObservations();
          continue;
        }

        // If duplicates exist locally for the same server observation, keep the preferred/newest one and remove extras.
        let localItem: LocalObservation | undefined;
        if (candidates.length > 1) {
          const forced = candidates.find(c => options?.forcePushObservationIds?.includes(c.id));
          const sorted = [...candidates].sort((a, b) => parseUtcMs(b.updatedAt) - parseUtcMs(a.updatedAt));
          localItem = forced ?? sorted[0];
          for (const dup of candidates) {
            if (dup.id !== localItem.id) {
              await deleteObservation(dup.id);
            }
          }
          localItems = await loadObservations();
        } else {
          localItem = candidates[0];
        }

        let resolvedCheckpointId: string | null = localItem?.checkpointId ?? null;
        if (!localItem || !resolvedCheckpointId) {
          const execution = await loadAuditExecution(serverItem.audit_id);
          const checkpointCandidates = execution.flatMap(eq => eq.checkpoints
            .filter(cp => normalizeObservationText(cp.checkpointText) === normalizeObservationText(serverItem.checkpoint_text))
            .map(cp => ({ eq, cp })));
          const exact = checkpointCandidates.filter(({ eq }) => normalizeObservationText(eq.name) === normalizeObservationText(serverItem.equipment_name));
          const exactType = checkpointCandidates.filter(({ eq }) => normalizeObservationText(eq.equipmentType) === normalizeObservationText(serverItem.equipment_type_name));
          const resolved = exact.length === 1 ? exact[0] : exactType.length === 1 ? exactType[0] : checkpointCandidates.length === 1 ? checkpointCandidates[0] : checkpointCandidates[0];
          if (resolved) {
            resolvedCheckpointId = resolved.cp.id;
          }
          if (!localItem) {
            if (!resolvedCheckpointId) continue;
            const localId = await createObservation({
              auditId: serverItem.audit_id,
              checkpointId: resolvedCheckpointId,
              findingType: serverFindingType,
              title: serverItem.checkpoint_text,
              description: serverItem.observation,
              severity: serverItem.severity ? serverItem.severity[0].toUpperCase() + serverItem.severity.slice(1).toLowerCase() : "",
              responsiblePerson: serverItem.responsible_person,
              actionText: serverItem.action_taken,
              targetDate: serverItem.target_date,
            });
            localItems = await loadObservations();
            localItem = localItems.find(item => item.id === localId);
          }
        }
        if (!localItem) continue;

        let latestServer = serverItem;
        const forcePush = Boolean(options?.forcePushObservationIds?.includes(localItem.id));
        const localMs = parseUtcMs(localItem.updatedAt);
        const serverMs = parseUtcMs(serverItem.updated_at);
        const hasLocalPending = ["pending", "error"].includes(localItem.syncStatus ?? "local");
        const needsPush =
          serverItem.status !== "withdrawn" &&
          (forcePush || (hasLocalPending && (!localItem.serverObservationId || localMs > serverMs)));

        if (needsPush) {
          try {
            const effectiveObservationText =
              localItem.description.trim() ||
              (normalizeObservationText(localItem.title) !== normalizeObservationText(serverItem.checkpoint_text) ? localItem.title.trim() : "");
            latestServer = await saveServerObservationDetails(serverBaseUrl, serverToken, serverItem.id, {
              observation: effectiveObservationText,
              severity: localItem.severity.toLowerCase(),
              responsible_person: localItem.responsiblePerson,
              target_date: localItem.targetDate,
            });
            const workingStatuses = ["open", "in_progress", "rejected", "reopened"];
            if (workingStatuses.includes(latestServer.status)) {
              for (const photo of localItem.actionPhotos ?? []) {
                const photoId = stableObservationPhotoId(localItem.id, photo.src);
                await uploadServerObservationPhoto(serverBaseUrl, serverToken, latestServer.id, photoId, photo.src, {
                  captured_at: photo.capturedAt ?? undefined,
                  latitude: photo.latitude,
                  longitude: photo.longitude,
                  gps_accuracy: photo.accuracy,
                });
              }
              if (localItem.actionText.trim() || localItem.closureDate) {
                latestServer = await updateServerObservationAction(serverBaseUrl, serverToken, latestServer.id, {
                  do: "save", action_taken: localItem.actionText, closure_date: localItem.closureDate,
                });
              }
            }
            pending++;
          } catch (syncError) {
            const reason = syncError instanceof Error ? syncError.message : "Observation synchronization failed.";
            await markObservationSyncError(localItem.id, reason);
            setMessage(`Observation remains saved locally. Server sync failed: ${reason}`);
            continue;
          }
        }
        const latestFindingType: FindingType =
          latestServer.finding_type === "OFI" || String(latestServer.response_status || "").toLowerCase() === "ofi"
            ? "OFI"
            : "NC";
        await linkObservationToServer({
          id: localItem.id,
          serverObservationId: latestServer.id,
          findingType: latestFindingType,
          checkpointId: resolvedCheckpointId,
          serverUpdatedAt: latestServer.updated_at,
          status: latestServer.status,
          severity: latestServer.severity,
          responsiblePerson: latestServer.responsible_person,
          description: latestServer.observation,
          actionText: latestServer.action_taken,
          targetDate: latestServer.target_date,
          closureDate: latestServer.closure_date,
        });
        linked++;
        localItems = await loadObservations();
      }
      const refreshed = await loadObservations();
      setObservations(refreshed);
      const unresolvedFindings = refreshed.filter(item => (!auditId || item.auditId === auditId) && !item.serverObservationId && (item.findingType === "NC" || item.findingType === "OFI")).length;
      setMessage(`Observation sync complete: ${linked} backend observation(s) linked${pending ? `, ${pending} local update(s) uploaded` : ""}${unresolvedFindings ? `. ${unresolvedFindings} NC/OFI finding(s) still have no server match; sync the audit manifest first` : ""}.`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Could not refresh backend observations.";
      setMessage(`Observation sync failed. Local data was preserved. ${reason}`);
    }
  }

  function normalizeObservationText(value: unknown) {
    return String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
  }

  async function handleCreateObservation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!observationDraft || !observationTitle.trim()) return;
    try {
      let savedId = observationDraft.observationId;
      if (savedId) {
        await updateObservationDetails({ id: savedId, title: observationTitle, description: observationDescription, severity: observationSeverity, responsiblePerson: observationResponsible, actionText: observationAction, targetDate: observationTargetDate, closureDate: observationClosureDate });
        await saveObservationActionPhotos(savedId, observationActionPhotos);
      } else {
        savedId = await createObservation({ ...observationDraft, title: observationTitle, description: observationDescription, severity: observationSeverity, responsiblePerson: observationResponsible, actionText: observationAction, targetDate: observationTargetDate });
        await updateObservationDetails({ id: savedId, title: observationTitle, description: observationDescription, severity: observationSeverity, responsiblePerson: observationResponsible, actionText: observationAction, targetDate: observationTargetDate, closureDate: observationClosureDate });
        await saveObservationActionPhotos(savedId, observationActionPhotos);
      }
      setObservations(await loadObservations());
      const savedLocal = (await loadObservations()).find(item => item.id === savedId);
      setObservationDraft(null); setObservationTitle(""); setObservationDescription(""); setObservationSeverity(""); setObservationResponsible(""); setObservationAction(""); setObservationTargetDate(""); setObservationClosureDate(""); setObservationActionPhotos([]);
      if (serverToken && savedLocal && (savedLocal.findingType === "NC" || savedLocal.findingType === "OFI")) {
        await refreshServerObservations(savedLocal.auditId, { forcePushObservationIds: [savedLocal.id] });
      } else {
        setMessage("Observation saved locally. Connect to the backend and synchronize to update the website.");
      }
    } catch (error) { console.error("[Solar Audit] Observation save failed:", error); setMessage("Could not save observation. Your audit data has been preserved."); }
  }

  function editObservation(o: LocalObservation) {
    setObservationDraft({ auditId: o.auditId, checkpointId: o.checkpointId ?? "", findingType: o.findingType, checkpointText: o.checkpointText, observationId: o.id });
    setObservationTitle(o.title);
    setObservationDescription(o.description);
    setObservationSeverity(o.severity || "");
    setObservationResponsible(o.responsiblePerson);
    setObservationAction(o.actionText);
    setObservationTargetDate(o.targetDate);
    setObservationClosureDate(o.closureDate || "");
    setObservationActionPhotos(o.actionPhotos ?? []);
  }

  async function submitObservationForReview(observation: LocalObservation) {
    if (!serverToken) { setMessage("Sign in to the backend before submitting an observation for review. Local data is preserved."); return; }
    try {
      if (!observation.serverObservationId) await refreshServerObservations(observation.auditId);
      const refreshed = (await loadObservations()).find(item => item.id === observation.id) ?? observation;
      if (!refreshed.serverObservationId) throw new Error("No matching backend observation exists yet. Sync the audit manifest and submit the audit first.");
      for (const photo of refreshed.actionPhotos ?? []) {
        const photoId = stableObservationPhotoId(refreshed.id, photo.src);
        await uploadServerObservationPhoto(serverBaseUrl, serverToken, refreshed.serverObservationId, photoId, photo.src, {
          captured_at: photo.capturedAt ?? undefined,
          latitude: photo.latitude,
          longitude: photo.longitude,
          gps_accuracy: photo.accuracy,
        });
      }
      const result = await updateServerObservationAction(serverBaseUrl, serverToken, refreshed.serverObservationId, {
        do: "submit", action_taken: refreshed.actionText, closure_date: refreshed.closureDate,
      });
      await linkObservationToServer({
        id: refreshed.id, serverObservationId: result.id, status: result.status,
        severity: result.severity, responsiblePerson: result.responsible_person, description: result.observation,
        actionText: result.action_taken, targetDate: result.target_date, closureDate: result.closure_date
      });
      setObservations(await loadObservations());
      setMessage("Observation submitted to the backend for Quality/Engineering review.");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Observation submission failed.";
      await markObservationSyncError(observation.id, reason);
      setObservations(await loadObservations());
      setMessage(`Observation was not submitted. Local data is preserved. ${reason}`);
    }
  }

  async function connectServer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (serverBusy) return;
    setServerBusy(true);
    setServerMessage("Signing in and loading your assigned plant data…");
    setServerToken("");
    setServerBootstrap(null);
    try {
      const result = await authenticateAndBootstrap(serverBaseUrl, serverUsername, serverPassword);
      // Keep the short-lived bearer token in memory only.
      // It is deliberately not written to SQLite or localStorage.
      setServerToken(result.token);
      setServerBootstrap(result.bootstrap);
      setServerPassword("");
      const connectedSiteId = result.bootstrap.sites?.[0]?.id || result.login.site?.id || "";
      const siteName = result.login.site?.name || result.bootstrap.sites[0]?.name || "CleanMax Solar Site";
      let latestReference: any = null;
      let typeCount = 0;
      if (connectedSiteId) {
        try {
          latestReference = await downloadSiteReferenceData(serverBaseUrl, result.token, connectedSiteId);
          await cacheServerReferenceData(latestReference);
          const types = Array.isArray(latestReference?.data?.asset_types) ? latestReference.data.asset_types : [];
          setServerAssetTypes(types.filter((item: any) => item && item.name).map((item: any) => ({ id: item.id, name: String(item.name).trim() })).sort((a: any, b: any) => a.name.localeCompare(b.name)));
          typeCount = types.length;
        } catch (referenceError) {
          console.warn("[Solar Audit] Could not refresh backend reference data during sign-in.", referenceError);
        }
      }

      const bootstrapPlants = Array.isArray(result.bootstrap.sites?.[0]?.plants) ? result.bootstrap.sites[0].plants : [];
      const refPlants = Array.isArray(latestReference?.data?.plants) ? latestReference.data.plants : bootstrapPlants;
      const assignedServerPlantIds = refPlants.map((p: any) => String(p?.id ?? "")).filter(Boolean);
      const assignedUserScope: AssignedUserScope = {
        id: String(result.login.user.id),
        username: result.login.user.username,
        fullName: result.login.user.full_name,
        role: result.login.user.role,
        siteId: connectedSiteId,
        assignedServerPlantIds,
      };

      const isSameUser = Boolean(workspace && workspace.assignedUser?.id === assignedUserScope.id);
      const baseWorkspace: Workspace = isSameUser && workspace
        ? { ...workspace, siteName: workspace.siteName || siteName, assignedUser: assignedUserScope }
        : {
            organizationName: "CleanMax Solar",
            siteName,
            siteLocation: "",
            plants: [],
            assignedUser: assignedUserScope,
          };

      const referencePayload = latestReference ?? {
        data: {
          site_id: connectedSiteId,
          plants: bootstrapPlants,
          assets: [],
          asset_types: [],
        },
      };
      const mergedWorkspace = connectedSiteId
        ? await mergeServerPlantsIntoWorkspace(baseWorkspace, referencePayload)
        : baseWorkspace;
      const finalWorkspace: Workspace = { ...mergedWorkspace, assignedUser: assignedUserScope };
      await saveWorkspace(finalWorkspace);
      setWorkspace(finalWorkspace);
      if (!isSameUser) {
        setActiveAudit(null);
        setSummaryAudit(null);
        setObservationDraft(null);
        setSection("Dashboard");
      }

      const plantCount = assignedServerPlantIds.length;
      setServerMessage(
        `Signed in as ${result.login.user.full_name || result.login.user.username} (${siteName}). Loaded ${plantCount} assigned plant(s)${typeCount ? ` and ${typeCount} equipment types` : ""}.`,
      );
    } catch (error) {
      const text = error instanceof Error ? error.message : "Could not connect to the server.";
      setServerMessage(text);
    } finally {
      setServerBusy(false);
    }
  }

  async function downloadAndCacheReferenceData() {
    if (!serverToken || referenceDataBusy) return;
    const site = serverBootstrap?.sites?.[0];
    if (!site?.id) {
      setReferenceDataMessage("The authenticated server did not return a site ID.");
      return;
    }
    setReferenceDataBusy(true);
    setReferenceDataMessage("Downloading and validating reference data…");
    try {
      const result = await downloadSiteReferenceData(serverBaseUrl, serverToken, site.id);
      await cacheServerReferenceData(result);
      const types = Array.isArray(result?.data?.asset_types) ? result.data.asset_types : [];
      setServerAssetTypes(types.filter((item: any) => item && item.name).map((item: any) => ({ id: item.id, name: String(item.name).trim() })).sort((a: any, b: any) => a.name.localeCompare(b.name)));
      if (!workspace) throw new Error("Create or load the local workspace before importing server plants.");
      const mergedWorkspace = await mergeServerPlantsIntoWorkspace(workspace, result);
      await saveWorkspace(mergedWorkspace);
      setWorkspace(mergedWorkspace);
      setReferenceDataMessage(
        `Server reference data cached and connected: ${result.data.plants.length} server plants, ${result.data.assets.length} assets, ${result.data.checklist.questions.length} checklist questions. Existing local-only plants and audits were preserved.`,
      );
    } catch (error) {
      setReferenceDataMessage(error instanceof Error ? error.message : "Reference-data download failed.");
    } finally {
      setReferenceDataBusy(false);
    }
  }

  const normalizeMappingText = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();

  async function syncOneAuditManifest(audit: LocalAudit, options?: { throwOnFailure?: boolean }) {
    if (!serverToken) {
      const msg = "Sign in to the native API in Settings first.";
      setAuditSyncMessages((old) => ({ ...old, [audit.id]: msg }));
      if (options?.throwOnFailure) throw new Error(msg);
      return;
    }
    if (auditSyncBusyId) {
      if (options?.throwOnFailure) throw new Error("Another audit synchronization is already in progress.");
      return;
    }
    setAuditSyncBusyId(audit.id);
    setAuditSyncMessages((old) => ({ ...old, [audit.id]: "Validating mappings before upload…" }));
    try {
      const cached = await loadCachedServerReferenceData();
      const ref = cached?.data;
      if (!ref || !Array.isArray(ref.plants) || !Array.isArray(ref.asset_types) || !Array.isArray(ref.checklist?.questions)) {
        throw new Error("Download & cache reference data in Settings before syncing.");
      }
      const localPlantName =
        audit.plantName ||
        current.plants.find((p) => p.id === audit.plantId)?.name ||
        "(unknown local plant)";

      const localPlant = current.plants.find((p) => p.id === audit.plantId);
      const exactServerIdMatch = localPlant?.serverPlantId
        ? ref.plants.find((p: any) => String(p.id) === String(localPlant.serverPlantId))
        : undefined;
      const exactNameMatch = localPlant?.serverPlantId
        ? undefined
        : ref.plants.find((p: any) => normalizeMappingText(p.name) === normalizeMappingText(localPlantName));

      const serverPlant = exactServerIdMatch || exactNameMatch;

      if (!serverPlant) {
        const serverPlantNames = ref.plants
          .map((p: any) => `${p.name} [ID: ${p.id}]`)
          .join("\n");

        throw new Error(
          `Plant mapping failed.\n` +
          `Local plant: ${localPlantName}\n` +
          `Local plant ID: ${audit.plantId}\n` +
          `Cached server plants:\n${serverPlantNames || "(none)"}\n` +
          `No data was uploaded.`
        );
      }
      const execution = await loadAuditExecutionPhotoRefs(audit.id);
      if (!execution.length || !execution.some((eq) => eq.checkpoints.length)) throw new Error("This audit has no checkpoints to sync yet.");
      const existingObservations = await loadObservations();
      const assets: AuditManifestPayload["assets"] = [];
      const responses: AuditManifestPayload["responses"] = [];
      const photoQueue: Array<{ checkpointId: string; photoIndex: number; photo: PhotoItem; questionId: number; assetRef: string }> = [];
      for (const eq of execution) {
        const typeNorm = normalizeMappingText(eq.equipmentType);
        const isSafety = typeNorm.includes("safety");
        const isCivil = typeNorm.includes("civil");
        const assetRef = isSafety ? "Site Safety" : isCivil ? "Civil / Infrastructure" : eq.id;
        let serverType: any = null;
        if (!isSafety && !isCivil) {
          const candidates = ref.asset_types.filter((t: any) => normalizeMappingText(t.name) === typeNorm);
          if (candidates.length !== 1) throw new Error(`Equipment type “${eq.equipmentType}” has ${candidates.length} exact server type matches. No data was uploaded.`);
          serverType = candidates[0];
          assets.push({ asset_ref: assetRef, asset_type_id: Number(serverType.id), asset_name: eq.name, location: "", rank: "N/A", observation: "", remarks: "", is_audited: eq.checkpoints.some((cp) => cp.result !== "NA") });
        }
        for (const cp of eq.checkpoints) {
          const questionTypeName = isSafety ? "Site Safety" : isCivil ? "Civil / Infrastructure" : String(serverType?.name ?? "");
          const questionMatches = ref.checklist.questions.filter((q: any) => normalizeMappingText(q.text) === normalizeMappingText(cp.checkpointText) && normalizeMappingText(q.asset_type_name) === normalizeMappingText(questionTypeName));
          if (questionMatches.length !== 1) throw new Error(`Checkpoint “${cp.checkpointText}” has ${questionMatches.length} exact server question matches for “${questionTypeName}”. No data was uploaded.`);
          const result = cp.result === "C" ? "pass" : cp.result === "NC" ? "fail" : cp.result === "OFI" ? "ofi" : "na";
          const localObs = existingObservations.find((o) =>
            o.auditId === audit.id &&
            (o.checkpointId === cp.id || normalizeMappingText(o.checkpointText || o.title) === normalizeMappingText(cp.checkpointText))
          );
          const obsText = (cp.result === "NC" || cp.result === "OFI")
            ? (localObs?.description?.trim() || cp.remarks?.trim() || "")
            : "";
          responses.push({ asset_ref: assetRef, question_id: Number(questionMatches[0].id), response_status: result, remarks: cp.remarks || "", observation: obsText });
          (cp.photos ?? []).forEach((photo, photoIndex) => photoQueue.push({ checkpointId: cp.id, photoIndex, photo, questionId: Number(questionMatches[0].id), assetRef }));
        }
      }
      const payload: AuditManifestPayload = {
        local_uuid: audit.id, plant_id: String(serverPlant.id), plant_name: String(serverPlant.name),
        audit_date: audit.auditDate || new Date().toISOString().slice(0, 10), audit_time: "", audit_type: audit.auditType,
        auditor_name: audit.auditor || serverBootstrap?.user?.full_name || serverBootstrap?.user?.username || "", auditee_name: "",
        building_name: "", capacity_mw: String(serverPlant.capacity_mw ?? current.plants.find((p) => p.id === audit.plantId)?.capacityMw ?? ""),
        city: "", state: "", asset_id_ref: "", assets, responses,
      };
      const acknowledgement = await syncAuditManifest(serverBaseUrl, serverToken, audit.id, payload);
      await saveAuditSyncAcknowledgement(audit.id, acknowledgement);
      await refreshServerObservations(audit.id);
      let photosUploaded = 0;
      let photosProcessed = 0;
      const photoErrors: string[] = [];
      const totalPhotos = photoQueue.length;
      if (totalPhotos > 0) {
        setAuditSyncMessages((old) => ({ ...old, [audit.id]: `Manifest synced. Uploading 0 / ${totalPhotos} photos…` }));
      }
      let queueCursor = 0;
      const uploadWorker = async () => {
        while (queueCursor < totalPhotos) {
          const item = photoQueue[queueCursor++];
          try {
            const dataUrl = await resolvePhotoRef(item.photo.src);
            if (!dataUrl) throw new Error("Photo file could not be read from device storage.");
            // Content-addressed RFC-4122 UUID derived from the audit, checkpoint, and file/image identity.
            const seed = `${audit.id}:${item.checkpointId}:${item.photo.src.startsWith("capfs:") ? item.photo.src : dataUrl}`;
            const hash32 = (input: string, salt: number) => {
              let hash = (2166136261 ^ salt) >>> 0;
              for (let i = 0; i < input.length; i++) hash = Math.imul(hash ^ input.charCodeAt(i), 16777619) >>> 0;
              return hash.toString(16).padStart(8, "0");
            };
            const raw = `${hash32(seed, 0)}${hash32(seed, 0x9e3779b9)}${hash32(seed, 0x85ebca6b)}${hash32(seed, 0xc2b2ae35)}`.split("");
            raw[12] = "4"; // UUID version 4 shape
            raw[16] = ((parseInt(raw[16], 16) & 0x3) | 0x8).toString(16); // RFC variant
            const hex = raw.join("");
            const photoId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
            const serverAssetId = !["Site Safety", "Civil / Infrastructure"].includes(item.assetRef)
              ? String(acknowledgement.asset_map?.[item.assetRef] ?? "")
              : undefined;
            if (!["Site Safety", "Civil / Infrastructure"].includes(item.assetRef) && !serverAssetId) {
              throw new Error(`Backend did not return a server equipment ID for asset reference “${item.assetRef}”. Re-sync the audit manifest before uploading its photos.`);
            }
            await syncAuditPhoto(serverBaseUrl, serverToken, audit.id, photoId, {
              question_id: item.questionId,
              asset_ref: item.assetRef,
              asset_id: serverAssetId,
              dataUrl,
              captured_at: item.photo.capturedAt ?? undefined,
              latitude: item.photo.latitude,
              longitude: item.photo.longitude,
              gps_accuracy: item.photo.accuracy,
              remark: item.photo.remark,
            });
            photosUploaded++;
          } catch (photoError) {
            photoErrors.push(photoError instanceof Error ? photoError.message : "Unknown photo upload error");
          } finally {
            photosProcessed++;
            if (photosProcessed % 3 === 0 || photosProcessed === totalPhotos) {
              setAuditSyncMessages((old) => ({ ...old, [audit.id]: `Uploading photos: ${photosProcessed} / ${totalPhotos} (${photosUploaded} succeeded)…` }));
            }
          }
        }
      };
      const workerCount = Math.min(3, totalPhotos);
      await Promise.all(Array.from({ length: workerCount }, () => uploadWorker()));
      if (photoErrors.length && options?.throwOnFailure) {
        throw new Error(`Audit manifest synced, but ${photoErrors.length} photo(s) failed to upload: ${photoErrors[0]}`);
      }
      if (audit.status === "submitted" && !options?.throwOnFailure) {
        await completeServerAudit(serverBaseUrl, serverToken, audit.id);
        await refreshServerObservations(audit.id);
      }
      const summary = `Manifest synced. Audit #${acknowledgement.audit_number ?? "received"}; ${assets.length} assets, ${responses.length} responses; ${photosUploaded}/${photoQueue.length} photos uploaded.`;
      setAuditSyncMessages((old) => ({ ...old, [audit.id]: photoErrors.length ? `${summary} Photo errors: ${photoErrors.slice(0, 2).join("; ")}` : `${summary} ${photoQueue.length ? "Photos confirmed by server." : "No checkpoint photos were attached to this audit."}` }));
    } catch (error) {
      setAuditSyncMessages((old) => ({ ...old, [audit.id]: error instanceof Error ? error.message : "Manifest sync failed. Local audit remains unchanged." }));
      if (options?.throwOnFailure) throw error;
    } finally {
      setAuditSyncBusyId("");
    }
  }

  async function refreshServerAuditStatuses() {
    if (!serverToken) { setMessage("Sign in to the native API in Settings before refreshing server audit statuses."); return; }
    try {
      const serverAudits = await fetchServerAuditStatuses(serverBaseUrl, serverToken);
      const changed = await reconcileServerAuditStatuses(serverAudits);
      const refreshed = await loadAudits();
      setAudits(refreshed);
      setMessage(`Server status refresh complete. ${changed} local audit status(es) updated; responses and photos were preserved.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not refresh audit statuses from the server.");
    }
  }

  function disconnectServer() {
    setServerToken("");
    setServerBootstrap(null);
    setServerPassword("");
    setServerMessage("Signed out of the native API on this screen. Local audits remain unchanged.");
  }

  function resetWorkspace() {
    if (!window.confirm("Sign out and reset this local workspace? You will need to sign in again to access plant data.")) return;
    setServerToken("");
    setServerBootstrap(null);
    setServerPassword("");
    setServerMessage("");
    setActiveAudit(null);
    setSummaryAudit(null);
    setObservationDraft(null);
    setWorkspace(null);
    setSection("Dashboard");
    setMessage("Signed out and local workspace reset.");
  }

  const pageTitle = useMemo(() => section, [section]);
  const equipmentCategories = useMemo(() => {
    const backendNames = [...new Set(serverAssetTypes.map((item) => item.name.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    return backendNames.length ? backendNames : TECHNICAL_CATEGORIES;
  }, [serverAssetTypes]);

  if (!hasWorkspace) {
    return (
      <main className="setup-page">
        <div className="setup-brand"><div className="brand-mark"><Icon name="sun" /></div><div><span className="eyebrow">FIELD OPERATIONS</span><h1>Solar Audit<span> Mobile</span></h1></div></div>
        <div className="setup-layout">
          <section className="setup-intro">
            <span className="pill"><span className="status-dot" /> PLANT ACCESS LOGIN</span>
            <h2>Sign in to load your assigned plant.</h2>
            <p>Each user account is scoped to its assigned solar plant(s). Sign in with your plant credentials to download your plant&apos;s equipment, checklists, and audit workspace.</p>
            <div className="setup-points"><div><span>01</span><div><b>Authenticate</b><small>Enter your assigned username and password.</small></div></div><div><span>02</span><div><b>Plant-scoped data</b><small>Only the plant(s) assigned to your credentials are loaded.</small></div></div><div><span>03</span><div><b>Work offline in the field</b><small>Conduct audits, capture geo-tagged photos, and sync when online.</small></div></div></div>
          </section>
          <form className="setup-card" onSubmit={(event) => void connectServer(event)}>
            <div className="card-kicker">SIGN IN REQUIRED</div><h3>Sign in to Solar Audit</h3><p className="muted">Connect to your CleanMax Solar Audit server.</p>
            <label>Native API base URL <span>*</span><input type="url" value={serverBaseUrl} onChange={(e) => setServerBaseUrl(e.target.value)} placeholder="http://10.0.2.2:5010/api/mobile/v1" required autoCapitalize="none" autoCorrect="off" /></label>
            <label>Username <span>*</span><input value={serverUsername} onChange={(e) => setServerUsername(e.target.value)} placeholder="Enter your plant username" autoComplete="username" autoCapitalize="none" required /></label>
            <label>Password <span>*</span><input type="password" value={serverPassword} onChange={(e) => setServerPassword(e.target.value)} placeholder="Enter password" autoComplete="current-password" required /></label>
            {serverMessage && <div className={`server-result ${serverBusy ? "pending" : ""}`} role="status">{serverMessage}</div>}
            <button className="primary-button full-button" type="submit" disabled={serverBusy}>{serverBusy ? "Signing in…" : "Sign in & load plant data"} <Icon name="arrow" /></button>
            <div className="local-note"><Icon name="cloud" /><span><b>Plant-scoped security</b><br />Your password is never stored on this device. Only plants assigned to your account are shown.</span></div>
          </form>
        </div>
        <footer className="setup-footer">SOLAR AUDIT MOBILE <span>•</span> PLANT-SCOPED ACCESS</footer>
      </main>
    );
  }

  const current = workspace as Workspace;
  const observationPlants = [...new Set(visibleObservations.map((o) => o.plantName || "Plant"))].sort((a, b) => a.localeCompare(b));
  const filteredObservations = visibleObservations.filter((o) => {
    const query = observationSearch.trim().toLowerCase();
    const matchesSearch = !query || [o.title, o.checkpointText, o.description, o.auditTitle, o.plantName, o.responsiblePerson]
      .some((value) => String(value ?? "").toLowerCase().includes(query));
    const matchesFinding = observationFindingFilter === "ALL" || o.findingType === observationFindingFilter;
    const matchesPlant = observationPlantFilter === "all" || (o.plantName || "Plant") === observationPlantFilter;
    const openStatuses = ["open", "in_progress", "rejected", "reopened"];
    const matchesStatus = observationStatusFilter === "all"
      || (observationStatusFilter === "open" && openStatuses.includes(o.status))
      || (observationStatusFilter === "in_progress" && o.status === "in_progress")
      || (observationStatusFilter === "closed" && o.status === "closed");
    return matchesSearch && matchesFinding && matchesPlant && matchesStatus;
  });

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><div className="brand-mark"><Icon name="sun" /></div><div><strong>Solar Audit</strong><small>Mobile workspace</small></div></div>
        <div className="workspace-label">WORKSPACE</div>
        <div className="workspace-mini"><div className="workspace-avatar">{(assignedUser?.fullName || assignedUser?.username || current.organizationName).slice(0, 1).toUpperCase()}</div><div className="workspace-copy"><b>{assignedUser?.fullName || assignedUser?.username || current.organizationName}</b><small>{visiblePlants.length === 1 ? visiblePlants[0].name : current.siteName}</small></div></div>
        <nav className="side-nav" aria-label="Main navigation">
          {navItems.map((item) => <button key={item.label} className={section === item.label ? "nav-item active" : "nav-item"} onClick={() => { setSection(item.label); setMessage(""); }}><Icon name={item.icon} /><span>{item.label}</span>{item.label === "Audits" && <em>{visibleAudits.length}</em>}</button>)}
        </nav>
        <div className="sidebar-bottom"><div className="sync-mini"><span className="status-dot green" /><div><b>On-device workspace</b><small>Offline-ready data storage</small></div></div><small className="version-label">Solar Audit Mobile</small></div>
      </aside>

      <main className="main-panel">
        <header className="topbar"><div><div className="breadcrumb">Workspace <span>/</span> {pageTitle}</div><h1>{pageTitle}</h1></div><div className="topbar-actions"><span className="offline-chip"><span className={`status-dot ${serverToken ? "green" : "amber"}`} />{serverToken ? "Backend connected" : "Backend not connected"}</span><button type="button" className="profile-badge profile-settings-button" onClick={() => { setSection("Settings"); setMessage(""); }} aria-label="Open settings" title="Settings">{current.organizationName.slice(0, 1).toUpperCase()}</button></div></header>
        {message && <div className="toast-message" role="status">{message}<button onClick={() => setMessage("")} aria-label="Dismiss">×</button></div>}

        {section === "Dashboard" && <div className="page-content dashboard-v2">
          <section className="dashboard-hero">
            <div className="dashboard-hero-copy"><span className="eyebrow light">OPERATIONS OVERVIEW</span><h2>{current.siteName}</h2><p>{current.organizationName}{current.siteLocation ? ` · ${current.siteLocation}` : ""}</p><div className="hero-actions"><button className="banner-button" onClick={() => { setSection("Audits"); setShowAuditForm(true); }}><Icon name="plus" /> Start an audit</button><button className="hero-secondary" onClick={() => setSection("Sites & Plants")}>View plants <Icon name="arrow" /></button></div></div>
            <div className="dashboard-hero-art" aria-hidden="true"><div className="hero-sun" /><div className="hero-panel"><i /><i /><i /><i /><i /><i /></div></div>
          </section>
          <div className="dashboard-section-title"><div><span className="card-kicker">AT A GLANCE</span><h2>Site overview</h2><p>Your audit activity on this device.</p></div><span className="live-tag"><span className="status-dot green" /> LIVE</span></div>
          <div className="metric-grid dashboard-metrics">
            <button className="metric-card metric-action" onClick={() => setSection("Sites & Plants")}><div className="metric-top"><span>Assigned plants</span><div className="metric-icon"><Icon name="plant" /></div></div><strong>{plantsCount}</strong><small>View plant register <Icon name="arrow" /></small></button>
            <button className="metric-card metric-action" onClick={() => setSection("Audits")}><div className="metric-top"><span>Total audits</span><div className="metric-icon"><Icon name="audit" /></div></div><strong>{visibleAudits.length}</strong><small>View audit register <Icon name="arrow" /></small></button>
            <button className="metric-card metric-action" onClick={() => setSection("Observations")}><div className="metric-top"><span>Open observations</span><div className="metric-icon"><Icon name="eye" /></div></div><strong>{visibleObservations.filter((o) => o.status !== "closed").length}</strong><small>NC and OFI findings</small></button>
            <button className="metric-card metric-action" onClick={() => setSection("Reports")}><div className="metric-top"><span>Audit PDFs available</span><div className="metric-icon"><Icon name="report" /></div></div><strong>{visibleAudits.length}</strong><small>Generate audit PDFs</small></button>
          </div>
          <section className="dashboard-quick-actions"><div className="dashboard-section-title compact"><div><span className="card-kicker">SHORTCUTS</span><h2>Quick actions</h2></div></div><div className="quick-action-grid"><button onClick={() => { setSection("Audits"); setShowAuditForm(true); }}><span className="quick-icon"><Icon name="plus" /></span><span><b>Start audit</b><small>Create a new inspection</small></span><Icon name="arrow" /></button><button onClick={() => setSection("Audits")}><span className="quick-icon"><Icon name="audit" /></span><span><b>Audit register</b><small>Continue a saved audit</small></span><Icon name="arrow" /></button><button onClick={() => setSection("Observations")}><span className="quick-icon"><Icon name="eye" /></span><span><b>Observations</b><small>Review NC and OFI findings</small></span><Icon name="arrow" /></button><button onClick={() => setSection("Reports")}><span className="quick-icon"><Icon name="report" /></span><span><b>Reports</b><small>Generate and share PDFs</small></span><Icon name="arrow" /></button></div></section>
          <div className="dashboard-bottom-grid"><section className="content-card recent-audits-card"><div className="card-heading"><div><span className="card-kicker">RECENT ACTIVITY</span><h3>Recent audits</h3><p>Your latest audit records.</p></div><button className="text-button" onClick={() => setSection("Audits")}>View all <Icon name="arrow" /></button></div>{visibleAudits.length ? <div className="recent-audit-list">{visibleAudits.slice(0, 4).map((audit) => <button className="recent-audit-row" key={audit.id} onClick={() => { setSection("Audits"); void openAudit(audit); }}><span className="recent-audit-icon"><Icon name="audit" /></span><span className="recent-audit-copy"><b>{audit.title}</b><small>{audit.plantName} · {audit.auditDate}</small></span><span className="recent-audit-status">{audit.status.replaceAll("_", " ")}</span><Icon name="arrow" /></button>)}</div> : <div className="dashboard-empty"><p>No audits have been created for your assigned plant(s) yet.</p><button className="secondary-button" onClick={() => { setSection("Audits"); setShowAuditForm(true); }}>Create first audit <Icon name="arrow" /></button></div>}</section>
            <section className="content-card current-site-card"><div className="card-heading"><div><span className="card-kicker">WORKSPACE</span><h3>Current site</h3><p>Active inspection location.</p></div><div className="metric-icon"><Icon name="site" /></div></div><div className="current-site-name"><span className="site-pin"><Icon name="site" /></span><div><b>{current.siteName}</b><small>{current.siteLocation || "Location not specified"}</small></div></div><div className="summary-divider" /><div className="summary-line"><span>Organization</span><b>{current.organizationName}</b></div><div className="summary-line"><span>Registered plants</span><b>{plantsCount}</b></div><button className="secondary-button full-button" onClick={() => setSection("Sites & Plants")}>Manage plants <Icon name="arrow" /></button></section></div>
        </div>}

        {section === "Sites & Plants" && <div className="page-content"><div className="section-heading"><div><h2>Sites & plants</h2><p>Connected plants are loaded from the backend; local-only plants remain offline drafts.</p></div><button className="primary-button" onClick={() => setShowPlantForm((v) => !v)}><Icon name="plus" /> Add plant</button></div><section className="content-card site-details-card"><div className="card-heading"><div><span className="card-kicker">ACTIVE SITE</span><h3>{current.siteName}</h3><p>{current.siteLocation || "No location provided"}</p></div><div className="site-status">Active workspace</div></div><div className="summary-divider" /><div className="summary-line"><span>Organization</span><b>{current.organizationName}</b></div><div className="summary-line"><span>Plants registered</span><b>{plantsCount}</b></div></section>
          {showPlantForm && <form className="content-card plant-form" onSubmit={addPlant}><div className="card-heading"><div><h3>Add a plant</h3><p>Enter only the details you know. No sample data is added.</p></div><button type="button" className="close-button" onClick={() => setShowPlantForm(false)} aria-label="Close">×</button></div><div className="form-grid"><label>Plant name <span>*</span><input value={plantName} onChange={(e) => setPlantName(e.target.value)} placeholder="e.g. Plant name" required /></label><label>Plant location<input value={plantLocation} onChange={(e) => setPlantLocation(e.target.value)} placeholder="Optional location" /></label><label>Capacity (MW)<input type="number" min="0" step="any" value={plantCapacity} onChange={(e) => setPlantCapacity(e.target.value)} placeholder="Optional capacity" /></label></div>
            <div className="plant-equipment-setup">
              <h4>Equipment inventory</h4>
              <p>Add the equipment this plant contains. Names are generated automatically and can be customized later.</p>
              <div className="form-grid">
                <label>Equipment category<select value={plantEquipmentCategory} onChange={(e) => setPlantEquipmentCategory(e.target.value)}><option value="">Select category</option>{equipmentCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
                <label>Quantity<input type="number" min="1" max="500" value={plantEquipmentQuantity} onChange={(e) => setPlantEquipmentQuantity(e.target.value)} /></label>
              </div>
              <button type="button" className="secondary-button" onClick={addEquipmentPlan}>Add category and quantity</button>
              {plantEquipmentPlan.length > 0 && <div className="inventory-plan-list">{plantEquipmentPlan.map((item) => <div className="inventory-plan-row" key={item.category}><span>{item.category}</span><b>{item.quantity}</b><button type="button" className="delete-button" onClick={() => setPlantEquipmentPlan((current) => current.filter((entry) => entry.category !== item.category))} aria-label={`Remove ${item.category}`}>×</button></div>)}</div>}
            </div>
            <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setShowPlantForm(false)}>Cancel</button><button className="primary-button" type="submit">Save plant</button></div></form>}
          <div className="section-heading compact-heading"><div><h2>Plant register</h2><p>{plantsCount} plant{plantsCount === 1 ? "" : "s"} added</p></div></div>
          {specPlant && <form className="content-card plant-form" onSubmit={(event) => void savePlantSpecificationsForm(event)}>
            <div className="card-heading"><div><h3>Plant specifications · {specPlant.name}</h3><p>Update technical specifications saved on the backend (leave blank to clear).</p></div><button type="button" className="close-button" onClick={() => setSpecPlant(null)} aria-label="Close">×</button></div>
            <div className="form-grid">
              {PLANT_SPEC_FIELDS.map(([key, label, numeric]) => (
                <label key={key}>{label}<input type={numeric ? "number" : "text"} min={numeric ? "0" : undefined} step={numeric ? "any" : undefined} value={specValues[key] ?? ""} onChange={(e) => setSpecValues((prev) => ({ ...prev, [key]: e.target.value }))} placeholder={numeric ? "0" : "Enter value"} /></label>
              ))}
            </div>
            <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setSpecPlant(null)}>Cancel</button><button className="primary-button" type="submit" disabled={specSaving}>{specSaving ? "Saving…" : "Save specifications"}</button></div>
          </form>}
          {plantsCount === 0 ? <div className="empty-state"><div className="empty-icon"><Icon name="plant" /></div><h3>No plants assigned yet</h3><p>No plants are assigned to your account yet. Contact your site administrator or sign in again.</p>{isAdminUser && <button className="primary-button" onClick={() => setShowPlantForm(true)}><Icon name="plus" /> Add first plant</button>}</div> : <div className="plant-list">{visiblePlants.map((plant) => <div className="plant-record" key={plant.id}><article className="plant-row"><div className="plant-symbol"><Icon name="plant" /></div><div className="plant-details"><b>{plant.name}</b><small>{plant.location || "Location not provided"}</small><small>{(plant.equipment ?? []).length} registered equipment item(s)</small></div><div className="plant-capacity"><small>CAPACITY</small><b>{plant.capacityMw ? `${plant.capacityMw} MW` : "—"}</b></div>{plant.source === "server" || plant.serverPlantId ? <><span className="site-status">Backend managed</span><button type="button" className="secondary-button" onClick={() => void editPlantSpecifications(plant)}>Plant specifications</button><button type="button" className="secondary-button" onClick={() => setConfigurePlantId((currentId) => currentId === plant.id ? "" : plant.id)}>{configurePlantId === plant.id ? "Done" : "Configure equipment"}</button></> : <><button type="button" className="secondary-button" onClick={() => void editPlantSpecifications(plant)}>Plant specifications</button><button type="button" className="secondary-button" onClick={() => setConfigurePlantId((currentId) => currentId === plant.id ? "" : plant.id)}>{configurePlantId === plant.id ? "Done" : "Configure equipment"}</button><button className="delete-button" onClick={() => deletePlant(plant.id)} aria-label={`Delete ${plant.name}`} title="Delete plant">×</button></>}</article>
            {configurePlantId === plant.id && <div className="plant-inventory-editor"><h4>Equipment inventory · {plant.name}</h4><div className="inventory-category-groups">{Object.entries((plant.equipment ?? []).reduce<Record<string, PlantEquipment[]>>((groups, item) => { const category = item.category || "Other / Custom"; (groups[category] ??= []).push(item); return groups; }, {})).length > 0 ? Object.entries((plant.equipment ?? []).reduce<Record<string, PlantEquipment[]>>((groups, item) => { const category = item.category || "Other / Custom"; (groups[category] ??= []).push(item); return groups; }, {})).map(([category, items]) => <details className="inventory-category-group" key={category}><summary className="inventory-category-summary-row"><span className="inventory-category-check" aria-label="Registered">✓</span><span className="inventory-category-name">{category}</span><b className="inventory-category-count">{items.length}</b><span className="inventory-category-chevron" aria-hidden="true">⌄</span></summary><div className="inventory-category-items">{items.map((item) => <div className="inventory-item-admin-row" key={item.id}><span>{item.name}</span><button type="button" className="text-button" onClick={() => renamePlantEquipment(plant.id, item.id, item.name)}>Rename</button><button type="button" className="delete-button" onClick={() => removePlantEquipment(plant.id, item.id, item.name)} aria-label={`Remove ${item.name}`}>×</button></div>)}</div></details>) : <p>No equipment registered yet.</p>}</div><div className="form-grid"><label>Category<select value={existingEquipmentCategory} onChange={(e) => setExistingEquipmentCategory(e.target.value)}><option value="">Select category</option>{equipmentCategories.map((category) => <option key={category} value={category}>{category}</option>)}</select></label><label>Quantity to add<input type="number" min="1" max="500" value={existingEquipmentQuantity} onChange={(e) => setExistingEquipmentQuantity(e.target.value)} /></label></div><button type="button" className="primary-button" onClick={() => addEquipmentToExistingPlant(plant.id)}>Add registered equipment</button></div>}
          </div>)}</div>}
        </div>}

        {section === "Audits" && <div className="page-content">
          <div className="section-heading"><div><h2>Audit register</h2><p>Create and manage audit drafts for your assigned plant(s).</p></div>{!activeAudit && !summaryAudit && <button className="primary-button" onClick={() => setShowAuditForm((v) => !v)} disabled={visiblePlants.length === 0}><Icon name="plus" /> Create audit</button>}</div>
          {visiblePlants.length === 0 && <div className="inline-notice">No plant is assigned to this account yet.</div>}
          {showAuditForm && <form className="content-card plant-form" onSubmit={handleCreateAudit}>
            <div className="card-heading"><div><h3>New audit</h3><p>Create one audit with Technical, Safety, and Civil sections.</p></div><button type="button" className="close-button" onClick={() => setShowAuditForm(false)} aria-label="Close">×</button></div>
            <div className="form-grid">
              <label>Plant <span>*</span><select value={auditPlantId} onChange={(e) => setAuditPlantId(e.target.value)} required><option value="">Select a plant</option>{visiblePlants.map((plant) => <option key={plant.id} value={plant.id}>{plant.name}</option>)}</select></label>
              <label>Audit title <span>*</span><input value={auditTitle} onChange={(e) => setAuditTitle(e.target.value)} placeholder="e.g. Monthly site audit" required /></label>
              <label>Audit date <span>*</span><input type="date" value={auditDate} onChange={(e) => setAuditDate(e.target.value)} required /></label>
              <label>Auditor name <span>*</span><input value={auditAuditor} onChange={(e) => setAuditAuditor(e.target.value)} placeholder="Enter auditor name" required /></label>
            </div>
            <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setShowAuditForm(false)}>Cancel</button><button className="secondary-button" type="submit" onClick={() => setContinueAfterCreate(false)}>Save draft</button><button className="primary-button" type="submit" onClick={() => setContinueAfterCreate(true)}>Continue audit</button></div>
          </form>}
          {summaryAudit && <section className="content-card audit-summary-page">
            <div className="card-heading"><div><span className="card-kicker">AUDIT SUMMARY</span><h3>{summaryAudit.title}</h3><p>{summaryAudit.plantName || current.plants.find((p) => p.id === summaryAudit.plantId)?.name || "Plant"} · {summaryAudit.auditType} · {summaryAudit.auditDate}</p></div><span className="audit-status">Submitted · Locked</span></div>
            <div className="execution-summary"><span>Auditor: <b>{summaryAudit.auditor}</b></span><span>Equipment items: <b>{executionEquipment.length}</b></span><span>Checkpoints: <b>{executionEquipment.reduce((n, eq) => n + eq.checkpoints.length, 0)}</b></span><span>NC: <b>{executionEquipment.reduce((n, eq) => n + eq.checkpoints.filter(cp => cp.result === "NC").length, 0)}</b></span><span>OFI: <b>{executionEquipment.reduce((n, eq) => n + eq.checkpoints.filter(cp => cp.result === "OFI").length, 0)}</b></span></div>
            <h4>Observations by equipment category</h4>
            {(() => { const auditObs = observations.filter(o => o.auditId === summaryAudit.id); const groups = new Map<string, LocalObservation[]>(); auditObs.forEach(o => { const eq = executionEquipment.find(e => e.checkpoints.some(cp => cp.id === o.checkpointId)); const category = eq?.equipmentType || (summaryAudit.auditType === "Safety" ? "Safety" : summaryAudit.auditType === "Civil" ? "Civil" : "Other / Unmapped"); groups.set(category, [...(groups.get(category) ?? []), o]); }); return auditObs.length === 0 ? <p>No NC or OFI observations were recorded for this audit.</p> : [...groups.entries()].map(([category, items]) => <details className="summary-observation-group" key={category}><summary>{category} <span>{items.length} observation(s)</span></summary><div>{items.map(o => <article key={o.id} className="summary-observation"><b>{o.title}</b><p>{o.checkpointText}</p><small>{o.findingType} · {o.severity} · {o.status}</small></article>)}</div></details>); })()}
            <div className="form-actions"><button className="secondary-button" onClick={() => { setSummaryAudit(null); setActiveAudit(null); }}>Back to audit register</button><button className="primary-button" onClick={() => setSection("Observations")}>View all observations</button></div>
          </section>}
          {!summaryAudit && activeAudit && <section className="content-card execution-panel">
            <div className="card-heading"><div><span className="card-kicker">AUDIT EXECUTION</span><h3>{activeAudit.title}</h3><p>{activeAudit.plantName || current.plants.find((p) => p.id === activeAudit.plantId)?.name} · {activeAudit.auditType} · {activeAudit.auditDate}</p></div><button type="button" className="secondary-button" onClick={() => setActiveAudit(null)}>Back to register</button></div>
            <div className="audit-mode-switch" role="group" aria-label="Audit type"><span>Audit section</span>{(["Technical", "Safety", "Civil"] as AuditType[]).map((type) => <button type="button" key={type} className={activeAudit.auditType === type ? "active" : ""} disabled={activeAudit.status === "submitted" || activeAudit.auditType === type} onClick={() => void switchAuditType(type)}>{type}</button>)}</div><div className="execution-summary"><span>Status: <b>{activeAudit.status.replace("_", " ")}</b></span><span>{executionEquipment.length} equipment item(s)</span><span>{executionEquipment.reduce((n, eq) => n + eq.checkpoints.length, 0)} checkpoint(s)</span></div>
            {activeAudit.auditType === "Technical" && <form className="equipment-form" onSubmit={handleAddEquipment}>
              <h4>Add equipment</h4>
              <div className="form-grid"><label>Equipment category <span>*</span><select value={equipmentType} onChange={(e) => { setEquipmentType(e.target.value); setEquipmentName(""); }} required>
                <option value="">Select category</option>
                {activeAudit.auditType === "Technical" && equipmentCategories.map((category) => <option key={category} value={category}>{category}</option>)}
              </select></label>
                <label>Equipment name <span>*</span><select value={equipmentName} onChange={(e) => setEquipmentName(e.target.value)} required disabled={!equipmentType}>
                  <option value="">{equipmentType ? "Select registered equipment" : "Select category first"}</option>
                  {(current.plants.find((plant) => plant.id === activeAudit.plantId)?.equipment ?? []).filter((item) => item.category === equipmentType).filter((item, index, items) => items.findIndex((candidate) => candidate.name.trim().toLocaleLowerCase() === item.name.trim().toLocaleLowerCase() && candidate.category.trim().toLocaleLowerCase() === item.category.trim().toLocaleLowerCase()) === index).filter((item) => !executionEquipment.some((added) => added.name.trim().toLocaleLowerCase() === item.name.trim().toLocaleLowerCase() && added.equipmentType.trim().toLocaleLowerCase() === item.category.trim().toLocaleLowerCase())).map((item) => <option key={`${item.category}:${item.name.trim().toLocaleLowerCase()}`} value={item.name}>{item.name}</option>)}
                </select>
                  {equipmentType && !(current.plants.find((plant) => plant.id === activeAudit.plantId)?.equipment ?? []).some((item) => item.category === equipmentType) && <small className="field-hint">No {equipmentType} registered for this plant. Add its equipment inventory under Sites &amp; Plants first.</small>}
                </label></div>
              <div className="form-actions"><button className="primary-button" type="submit" disabled={!equipmentType || !equipmentName}>Save equipment</button></div>
            </form>}
            {executionEquipment.length === 0 ? <div className="empty-execution"><h4>No equipment added</h4><p>Add the equipment you want to inspect for this audit.</p></div> : <>
              {activeAudit.auditType === "Technical" && <div className="equipment-filter"><label>View equipment checklist<select value={selectedEquipmentId} onChange={(e) => setSelectedEquipmentId(e.target.value)}><option value="">Select equipment to view checkpoints</option>{executionEquipment.filter((item) => item.equipmentType !== "Safety checklist" && item.equipmentType !== "Civil checklist").filter((item, index, items) => items.findIndex((candidate) => candidate.name.trim().toLocaleLowerCase() === item.name.trim().toLocaleLowerCase() && candidate.equipmentType.trim().toLocaleLowerCase() === item.equipmentType.trim().toLocaleLowerCase()) === index).map((item) => <option key={`${item.equipmentType}:${item.name.trim().toLocaleLowerCase()}`} value={item.id}>{item.name} · {item.equipmentType}</option>)}</select></label><small>Choose an equipment item to display its checkpoints.</small></div>}
              {(!selectedEquipmentId && activeAudit.auditType === "Technical") ? <div className="empty-execution"><h4>No equipment selected</h4><p>Select an equipment item above to view or edit its checkpoints.</p></div> : executionEquipment.filter((item) => item.id === selectedEquipmentId && (activeAudit.auditType !== "Technical" || (item.equipmentType !== "Safety checklist" && item.equipmentType !== "Civil checklist"))).map((equipment) => <article className="equipment-card" key={equipment.id}>
                <div className="equipment-card-heading"><div><h4>{equipment.name}</h4><small>{equipment.equipmentType || "Equipment"} · {equipment.checkpoints.length} checkpoint(s)</small></div></div>
                {equipment.checkpoints.length > 0 && <div className="checkpoint-list">{equipment.checkpoints.map((checkpoint) => <div className="checkpoint-card" key={checkpoint.id}>
                  <div className="checkpoint-title"><b>{checkpoint.checkpointText}</b><span className={`result-pill result-${checkpoint.result.toLowerCase()}`}>{checkpoint.result}</span></div>
                  <div className="result-selector" role="group" aria-label={`Result for ${checkpoint.checkpointText}`}>{(["C", "NC", "NA", "OFI"] as const).map((result) => <button type="button" key={result} className={checkpoint.result === result ? `result-option selected result-${result.toLowerCase()}` : "result-option"} onClick={() => void handleCheckpointChange(equipment.id, checkpoint, { result })}>{result === "C" ? "Compliant (C)" : result === "NC" ? "Non-Compliant (NC)" : result === "NA" ? "Not Applicable (NA)" : "Opportunity for Improvement (OFI)"}</button>)}</div>
                  <label className="remarks-label">Remarks<textarea value={checkpoint.remarks} onChange={(e) => void handleCheckpointChange(equipment.id, checkpoint, { remarks: e.target.value })} placeholder="Add inspection remarks..." rows={2} /></label><div className="checkpoint-photos"><div className="checkpoint-photo-heading"><b>Inspection photos</b><small>{(checkpoint.photos ?? []).length} saved</small></div><div className="photo-action-buttons"><button type="button" className="secondary-button photo-capture-button" disabled={activeAudit.status === "submitted"} onClick={() => void takeCheckpointPhoto(equipment.id, checkpoint)}>📷 Take Photo</button><label className="secondary-button photo-capture-button">🖼️ Choose from Gallery<input className="photo-file-input" type="file" accept="image/*" multiple disabled={activeAudit.status === "submitted"} onChange={(event) => { void handleCheckpointPhotos(equipment.id, checkpoint, event.currentTarget.files); event.currentTarget.value = ""; }} /></label></div>{(checkpoint.photos ?? []).length > 0 && <div className="checkpoint-photo-grid">{(checkpoint.photos ?? []).map((photo, photoIndex) => <div className="checkpoint-photo-item" key={`${checkpoint.id}-photo-${photoIndex}`}><div className="photo-thumb-wrap"><img src={photo.src} alt={`Inspection photo ${photoIndex + 1}`} />{renderPhotoLocationBadge(photo)}</div><input type="text" className="photo-remark-input" placeholder="Add photo remark..." value={photo.remark ?? ""} disabled={activeAudit.status === "submitted"} onChange={(e) => void updateCheckpointPhotoRemark(equipment.id, checkpoint, photoIndex, e.target.value)} /><button type="button" disabled={activeAudit.status === "submitted"} aria-label={`Remove photo ${photoIndex + 1}`} onClick={() => void removeCheckpointPhoto(equipment.id, checkpoint, photoIndex)}>Remove</button></div>)}</div>}<small className="photo-storage-note">Photos are compressed and saved locally with this checkpoint for offline use.</small></div>
                </div>)}</div>}
                <div className="equipment-save-row"><button type="button" className="secondary-button" disabled={activeAudit.status === "submitted"} onClick={() => setMessage(`${equipment.name}: equipment and checkpoint changes are saved on this device.`)}>Save equipment</button></div>
              </article>)}
            </>}
            <div className="submit-audit-panel"><div><b>Finish and lock this audit</b><small>Submit Audit finalizes the entire audit and prevents further edits.</small></div><div className="form-actions submit-audit-actions"><button type="button" className="primary-button" disabled={!activeAudit || activeAudit.status === "submitted"} onClick={() => void submitAudit()}>Submit Audit</button>{activeAudit?.status === "submitted" && <span className="observation-meta">Audit submitted and locked</span>}</div></div>
          </section>}
          {!activeAudit && !summaryAudit && (visibleAudits.length === 0 ? <div className="empty-state large-empty"><div className="empty-icon"><Icon name="audit" /></div><span className="card-kicker">AUDIT REGISTER</span><button type="button" className="secondary-button" onClick={() => void refreshServerAuditStatuses()} disabled={!serverToken}>Refresh server statuses</button><h3>No audits created yet</h3><p>Create your first Technical, Safety, or Civil audit for your assigned plant.</p><button className="primary-button" onClick={() => setShowAuditForm(true)} disabled={visiblePlants.length === 0}><Icon name="plus" /> Create first audit</button></div> : <div className="audit-list">{visibleAudits.map((audit) => <article className="audit-row" key={audit.id}><div className="audit-type-mark"><Icon name="audit" /></div><div className="audit-copy"><b>{audit.title}</b><small>{audit.plantName || current.plants.find((p) => p.id === audit.plantId)?.name || "Plant"} · {audit.auditType} · {audit.auditDate}</small><small>Auditor: {audit.auditor}</small></div><span className="audit-status">{audit.status.replace("_", " ")}</span><button className="secondary-button open-audit-button" onClick={() => void openAudit(audit)}>Open audit</button><button type="button" className="secondary-button open-audit-button" onClick={() => void refreshServerAuditStatuses()} disabled={!serverToken}>Refresh statuses</button><button type="button" className="secondary-button open-audit-button" disabled={!serverToken || auditSyncBusyId === audit.id} onClick={() => void syncOneAuditManifest(audit)}>{auditSyncBusyId === audit.id ? "Syncing…" : "Sync manifest"}</button>{auditSyncMessages[audit.id] && <small className="server-result" role="status">{auditSyncMessages[audit.id]}</small>}</article>)}</div>)}
        </div>}
        {section === "Observations" && <div className="page-content">
          <div className="section-heading"><div><h2>Observations</h2><p>NC and OFI findings across your assigned plant audits.</p></div><div className="form-actions"><span className="date-tag">{visibleObservations.filter(o => ["open", "in_progress", "rejected", "reopened"].includes(o.status)).length} OPEN</span><button className="secondary-button" onClick={() => void refreshServerObservations()}>Sync observations</button></div></div>
          {visibleObservations.length > 0 && <section className="observation-filter-panel" aria-label="Filter observations">
            <label className="observation-search"><span>Search observations</span><input type="search" value={observationSearch} onChange={(event) => setObservationSearch(event.target.value)} placeholder="Search title, checkpoint, audit or person…" /></label>
            <div className="observation-filter-row">
              <label><span>Finding type</span><select value={observationFindingFilter} onChange={(event) => setObservationFindingFilter(event.target.value as "ALL" | FindingType)}><option value="ALL">All findings</option><option value="NC">NC only</option><option value="OFI">OFI only</option></select></label>
              <label><span>Status</span><select value={observationStatusFilter} onChange={(event) => setObservationStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="open">Open</option><option value="in_progress">In progress</option></select></label>
              <label><span>Plant</span><select value={observationPlantFilter} onChange={(event) => setObservationPlantFilter(event.target.value)}><option value="all">All plants</option>{observationPlants.map((plant) => <option key={plant} value={plant}>{plant}</option>)}</select></label>
            </div>
            <div className="observation-filter-footer"><span>Showing <b>{filteredObservations.length}</b> of {visibleObservations.length} observations</span><button type="button" className="text-button" onClick={() => { setObservationSearch(""); setObservationFindingFilter("ALL"); setObservationStatusFilter("all"); setObservationPlantFilter("all"); }}>Clear filters</button></div>
          </section>}
          {observationDraft && <form className="content-card observation-form" onSubmit={(event) => void handleCreateObservation(event)}>
            <div className="card-heading"><div><span className="card-kicker">{observationDraft.findingType === "NC" ? "NON-COMPLIANCE" : "OPPORTUNITY FOR IMPROVEMENT"}</span><h3>{observationDraft.observationId ? "Complete observation details" : `New ${observationDraft.findingType} observation`}</h3><p>{observationDraft.checkpointText}</p></div><button type="button" className="secondary-button" onClick={() => setObservationDraft(null)}>Cancel</button></div>
            <div className="form-grid observation-grid"><label>Observation title <span>*</span><input value={observationTitle} onChange={e => setObservationTitle(e.target.value)} required /></label><label>Severity<select value={observationSeverity} onChange={e => setObservationSeverity(e.target.value)}><option value="">Unclassified</option><option>Minor</option><option>Major</option><option>Critical</option></select></label><label>Responsible person<input value={observationResponsible} onChange={e => setObservationResponsible(e.target.value)} placeholder="Name or role" /></label><label>Target closure date<input type="date" value={observationTargetDate} onChange={e => setObservationTargetDate(e.target.value)} /></label><label>Actual closure date<input type="date" value={observationClosureDate} onChange={e => setObservationClosureDate(e.target.value)} /></label><label className="wide-field">Description<textarea value={observationDescription} onChange={e => setObservationDescription(e.target.value)} rows={3} placeholder="Describe the finding..." /></label><label className="wide-field">{observationDraft.findingType === "NC" ? "Corrective action / Action taken" : "Improvement action / Action taken"}<textarea value={observationAction} onChange={e => setObservationAction(e.target.value)} rows={3} placeholder="Describe action taken or planned..." /></label></div>
            {(() => { const linked = observations.find(o => o.id === observationDraft.observationId); const checkpointPhotos = linked?.photos ?? []; return <div className="observation-photo-panel"><h4>Observation photos</h4><p>Inspection photos captured at this checkpoint appear here automatically.</p>{checkpointPhotos.length > 0 ? <div className="checkpoint-photo-grid">{checkpointPhotos.map((photo, index) => <div className="checkpoint-photo-item" key={`source-${index}`}><div className="photo-thumb-wrap"><img src={photo.src} alt={`Checkpoint inspection ${index + 1}`} />{renderPhotoLocationBadge(photo)}</div><small>Inspection photo {index + 1}</small>{photo.remark && <small className="photo-remark-readonly">{photo.remark}</small>}</div>)}</div> : <small>No checkpoint photos attached.</small>}<h4>Photos of action taken</h4><div className="photo-action-buttons"><button type="button" className="secondary-button photo-capture-button" onClick={() => void takeObservationActionPhoto()}>📷 Capture Action Photo</button><label className="secondary-button photo-capture-button">🖼️ Choose from Gallery<input className="photo-file-input" type="file" accept="image/*" multiple onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); files.forEach(file => void addObservationActionPhoto(file)); event.currentTarget.value = ""; }} /></label></div>{observationActionPhotos.length > 0 && <div className="checkpoint-photo-grid">{observationActionPhotos.map((photo, index) => <div className="checkpoint-photo-item" key={`action-${index}`}><div className="photo-thumb-wrap"><img src={photo.src} alt={`Action taken photo ${index + 1}`} />{renderPhotoLocationBadge(photo)}</div><input type="text" className="photo-remark-input" placeholder="Add photo remark..." value={photo.remark ?? ""} onChange={(e) => setObservationActionPhotos((curr) => curr.map((item, i) => i === index ? { ...item, remark: e.target.value } : item))} /><button type="button" onClick={() => setObservationActionPhotos(current => current.filter((_, i) => i !== index))}>Remove</button></div>)}</div>}</div>; })()}
            <div className="form-actions"><button type="submit" className="primary-button">Save observation</button></div>
          </form>}
          {visibleObservations.length === 0 ? <div className="empty-state large-empty"><div className="empty-icon"><Icon name="eye" /></div><h3>No observations yet</h3><p>Submit an audit with NC or OFI checkpoints to create observations here. Complete the follow-up details after submission.</p><button className="secondary-button" onClick={() => setSection("Audits")}>Go to audits <Icon name="arrow" /></button></div> : filteredObservations.length === 0 ? <div className="empty-state observation-no-results"><h3>No matching observations</h3><p>Try changing the search text or clearing one or more filters.</p><button type="button" className="secondary-button" onClick={() => { setObservationSearch(""); setObservationFindingFilter("ALL"); setObservationStatusFilter("all"); setObservationPlantFilter("all"); }}>Clear filters</button></div> : <div className="observation-list">{(() => { const plantGroups = new Map<string, LocalObservation[]>(); filteredObservations.forEach((o) => plantGroups.set(o.plantName || "Plant", [...(plantGroups.get(o.plantName || "Plant") ?? []), o])); return [...plantGroups.entries()].map(([plant, plantItems]) => { const auditGroups = new Map<string, LocalObservation[]>(); plantItems.forEach((o) => auditGroups.set(o.auditId, [...(auditGroups.get(o.auditId) ?? []), o])); return <details className="summary-observation-group observation-plant-group" key={plant} open><summary>{plant}<span>{plantItems.length} observation(s)</span></summary><div>{[...auditGroups.entries()].map(([auditId, auditItems]) => { return <details className="summary-observation-group" key={auditId}><summary>{auditItems[0]?.auditTitle || "Audit"}<span>{auditItems.length} observation(s)</span></summary><div>{auditItems.map((o) => <article className="content-card observation-row" key={o.id}><div className="observation-row-top"><span className={`finding-tag finding-${o.findingType.toLowerCase()}`}>{o.findingType}</span><span className={`observation-status status-${o.status}`}>{o.status}</span></div><h3>{o.title}</h3><p className="observation-meta">{o.checkpointText}</p>{o.description && <p>{o.description}</p>}<div className="observation-details"><span>Severity <b>{o.severity || "Unclassified"}</b></span><span>Responsible <b>{o.responsiblePerson || "Not assigned"}</b></span><span>Target date <b>{o.targetDate || "Not set"}</b></span></div>{o.actionText && <p><b>{o.findingType === "NC" ? "Corrective action / Action taken:" : "Improvement action / Action taken:"}</b> {o.actionText}</p>}{(o.photos?.length ?? 0) > 0 && <div className="observation-inline-photos"><b>Inspection photos</b><div className="checkpoint-photo-grid">{(o.photos ?? []).map((photo, index) => <div className="checkpoint-photo-item" key={`obs-${o.id}-${index}`}><div className="photo-thumb-wrap"><img src={photo.src} alt={`Inspection photo ${index + 1}`} />{renderPhotoLocationBadge(photo)}</div>{photo.remark && <small className="photo-remark-readonly">{photo.remark}</small>}</div>)}</div></div>}{(o.actionPhotos?.length ?? 0) > 0 && <div className="observation-inline-photos"><b>Action taken photos</b><div className="checkpoint-photo-grid">{(o.actionPhotos ?? []).map((photo, index) => <div className="checkpoint-photo-item" key={`obs-action-${o.id}-${index}`}><div className="photo-thumb-wrap"><img src={photo.src} alt={`Action taken photo ${index + 1}`} />{renderPhotoLocationBadge(photo)}</div>{photo.remark && <small className="photo-remark-readonly">{photo.remark}</small>}</div>)}</div></div>}<div className="observation-meta">{o.serverObservationId ? <span>Backend: {o.status.replace("_", " ")}</span> : <span>Local only{o.findingType === "OFI" ? " · awaiting audit sync" : " · awaiting audit sync"}</span>}{o.syncStatus === "error" && <span className="error-text">Sync issue: {o.syncError || "retry required"}</span>}</div><div className="form-actions"><button className="secondary-button" onClick={() => editObservation(o)}>Complete details</button>{o.serverObservationId && ["open", "in_progress", "rejected", "reopened"].includes(o.status) && <button className="primary-button" onClick={() => void submitObservationForReview(o)}>Submit for review</button>}</div></article>)}</div></details>; })}</div></details>; }); })()}</div>}
        </div>}
        {section === "Reports" && <div className="page-content">
          <div className="section-heading report-heading">
            <div><span className="card-kicker">DOCUMENT CENTRE</span><h2>Audit Reports</h2><p>Generate and share audit PDFs with checklist results, inspection photos, observations and action-taken photos.</p></div>
            <span className="date-tag">{visibleAudits.length} AUDIT(S)</span>
          </div>
          <div className="local-note report-note"><Icon name="report" /><span><b>Reports are generated on this device</b><br />Submitted audits are locked. Draft reports are clearly labelled with their current status.</span></div>
          <div className="report-metrics">
            <div className="report-metric-card"><span>Total audits</span><b>{visibleAudits.length}</b><small>Available for reporting</small></div>
            <div className="report-metric-card"><span>Submitted</span><b>{visibleAudits.filter((audit) => audit.status === "submitted").length}</b><small>Completed audit records</small></div>
            <div className="report-metric-card"><span>In progress</span><b>{visibleAudits.filter((audit) => audit.status === "in_progress").length}</b><small>Drafts and active work</small></div>
          </div>
          {visibleAudits.length === 0 ? <div className="empty-state large-empty"><div className="empty-icon"><Icon name="report" /></div><h3>No audits available</h3><p>Create an audit and save checklist results before generating a report.</p><button className="secondary-button" onClick={() => setSection("Audits")}>View audits <Icon name="arrow" /></button></div> : <>
            <div className="report-toolbar">
              <label className="report-search"><span>Search audits</span><input value={reportSearch} onChange={(event) => setReportSearch(event.target.value)} placeholder="Search audit, plant or auditor..." /></label>
              <label className="report-status-filter"><span>Status</span><select value={reportStatusFilter} onChange={(event) => setReportStatusFilter(event.target.value)}><option value="all">All statuses</option><option value="in_progress">In progress</option><option value="submitted">Submitted</option><option value="draft">Draft</option></select></label>
              <div className="report-result-count">{visibleAudits.filter((audit) => {
                const query = reportSearch.trim().toLowerCase();
                const plant = audit.plantName || current.plants.find((p) => p.id === audit.plantId)?.name || "Plant";
                const matchesSearch = !query || [audit.title, plant, audit.auditor || "", audit.auditType, audit.auditDate].some((value) => String(value).toLowerCase().includes(query));
                const matchesStatus = reportStatusFilter === "all" || audit.status === reportStatusFilter;
                return matchesSearch && matchesStatus;
              }).length} report(s) found</div>
            </div>
            <div className="report-list">{visibleAudits.filter((audit) => {
              const query = reportSearch.trim().toLowerCase();
              const plant = audit.plantName || current.plants.find((p) => p.id === audit.plantId)?.name || "Plant";
              const matchesSearch = !query || [audit.title, plant, audit.auditor || "", audit.auditType, audit.auditDate].some((value) => String(value).toLowerCase().includes(query));
              const matchesStatus = reportStatusFilter === "all" || audit.status === reportStatusFilter;
              return matchesSearch && matchesStatus;
            }).map((audit) => <article className="content-card report-row" key={audit.id}>
              <div className="report-card-top"><div className="audit-type-mark"><Icon name="report" /></div><span className={`audit-status report-status-${audit.status}`}>{audit.status.replaceAll("_", " ")}</span></div>
              <div className="audit-copy"><b>{audit.title}</b><small>{audit.plantName || current.plants.find((p) => p.id === audit.plantId)?.name || "Plant"} · {audit.auditType} · {audit.auditDate}</small><small>Auditor: {audit.auditor || "Not specified"}</small></div>
              <button className="primary-button report-generate-button" onClick={() => void generateAuditReport(audit)}><Icon name="report" /> Generate PDF</button>
            </article>)}
              {visibleAudits.filter((audit) => {
                const query = reportSearch.trim().toLowerCase();
                const plant = audit.plantName || current.plants.find((p) => p.id === audit.plantId)?.name || "Plant";
                const matchesSearch = !query || [audit.title, plant, audit.auditor || "", audit.auditType, audit.auditDate].some((value) => String(value).toLowerCase().includes(query));
                const matchesStatus = reportStatusFilter === "all" || audit.status === reportStatusFilter;
                return matchesSearch && matchesStatus;
              }).length === 0 && <div className="empty-state report-filter-empty"><h3>No matching audits</h3><p>Try another search or select a different status.</p><button className="secondary-button" onClick={() => { setReportSearch(""); setReportStatusFilter("all"); }}>Clear filters</button></div>}
            </div>
          </>}
        </div>}
        {section === "Settings" && <div className="page-content">
          <section className="content-card settings-card">
            <div className="card-heading"><div><h3>Workspace &amp; account scope</h3><p>Active user and plant assignment on this device.</p></div><div className="metric-icon"><Icon name="settings" /></div></div>
            <div className="settings-field"><span>Organization</span><b>{current.organizationName}</b></div>
            <div className="settings-field"><span>Site name</span><b>{current.siteName}</b></div>
            <div className="settings-field"><span>Signed-in user</span><b>{assignedUser ? `${assignedUser.fullName || assignedUser.username} (${assignedUser.username})` : "Not signed in"}</b></div>
            <div className="settings-field"><span>Assigned plant(s)</span><b>{visiblePlants.length ? visiblePlants.map((p) => p.name).join(", ") : "None"}</b></div>
          </section>
          <section className="content-card settings-card server-connection-card">
            <div className="card-heading"><div><span className="card-kicker">STAGE 1 · CONNECTIVITY TEST</span><h3>Native server connection</h3><p>Sign in and verify that the backend can return the configured site and reference data. This does not upload or modify audits.</p></div><span className={`connection-pill ${serverToken ? "connected" : "disconnected"}`}><span className="status-dot" />{serverToken ? "Connected" : "Not connected"}</span></div>
            <form onSubmit={(event) => void connectServer(event)} className="server-connection-form">
              <label>Native API base URL <span>*</span><input type="url" value={serverBaseUrl} onChange={(event) => setServerBaseUrl(event.target.value)} placeholder="http://10.0.2.2:5010/api/mobile/v1" required autoCapitalize="none" autoCorrect="off" /></label>
              <p className="server-url-help"><b>Which address should I use?</b> Android emulator: use <code>10.0.2.2</code> to reach your development PC. Physical Android device: use your PC's reachable LAN address. Production: use your approved HTTPS server domain. Keep the <code>/api/mobile/v1</code> path.</p>
              <div className="form-grid server-login-grid">
                <label>Username <span>*</span><input value={serverUsername} onChange={(event) => setServerUsername(event.target.value)} autoComplete="username" required /></label>
                <label>Password <span>*</span><input type="password" value={serverPassword} onChange={(event) => setServerPassword(event.target.value)} autoComplete="current-password" required /></label>
              </div>
              <div className="form-actions server-actions"><button type="submit" className="primary-button" disabled={serverBusy}>{serverBusy ? "Connecting…" : "Sign in & test bootstrap"}</button>{serverToken && <button type="button" className="secondary-button" onClick={disconnectServer}>Disconnect</button>}</div>
            </form>
            {serverMessage && <div className={`server-result ${serverToken ? "success" : serverBusy ? "pending" : ""}`} role="status">{serverMessage}</div>}
            {serverBootstrap && <div className="server-bootstrap-summary"><div className="settings-field"><span>Authenticated user</span><b>{serverBootstrap.user?.full_name || serverBootstrap.user?.username}</b></div><div className="settings-field"><span>Configured server site</span><b>{serverBootstrap.sites[0]?.name || "No site returned"}</b></div><div className="settings-field"><span>Plants returned by server</span><b>{serverBootstrap.sites.reduce((count, site) => count + (site.plants?.length ?? 0), 0)}</b></div><div className="settings-field"><span>API version</span><b>{serverBootstrap.api_version || "Unknown"}</b></div><p className="field-hint">Reference data is stored separately from the active workspace. It will not overwrite local plant or audit records.</p><button type="button" className="primary-button full-button" onClick={() => void downloadAndCacheReferenceData()} disabled={referenceDataBusy || !serverToken}>{referenceDataBusy ? "Downloading reference data…" : "Download & cache reference data"}</button>{referenceDataMessage && <div className={`server-result ${referenceDataMessage.startsWith("Reference data cached") ? "success" : ""}`} role="status">{referenceDataMessage}</div>}</div>}
            <div className="local-note settings-note"><Icon name="cloud" /><span><b>Connection & data safety</b><br />The API address is remembered on this device. Your password and access token are never saved; sign in again after restarting the app. Signing in verifies access and loads reference data only—it does not upload audits, photos, observations, or workspace records.</span></div>
          </section>
          <section className="content-card settings-card"><div className="danger-zone"><div><b>Sign out &amp; switch account</b><small>Clears the active workspace and returns to the login screen so another plant account can sign in.</small></div><button className="danger-button" onClick={resetWorkspace}>Sign out &amp; switch</button></div></section>
        </div>}
        <footer className="main-footer"><span>Solar Audit Mobile</span><span>Offline-ready field inspection workspace</span></footer>
      </main>
      <nav className="mobile-nav" aria-label="Mobile navigation">{navItems.map((item) => <button key={item.label} className={section === item.label ? "mobile-nav-item active" : "mobile-nav-item"} onClick={() => { setSection(item.label); setMessage(""); }}><Icon name={item.icon} /><span>{item.label === "Sites & Plants" ? "Plants" : item.label}</span></button>)}</nav>
    </div>
  );
}


