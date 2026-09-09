import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MapContainer, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  createRoad, createRoadSurvey, getRoadSurveyGeometry, listDistricts,
  listRoads, listRoadSurveys, listVehicles, reviewRoadSurvey, submitRoadSurvey,
} from "@/lib/db";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle, CheckCircle2, ClipboardCheck, Clock3, Map, MapPin,
  Plus, RefreshCw, Ruler, Route, Send, Truck, X,
} from "lucide-react";

const SL_CENTER: [number, number] = [8.5, -11.8];

function normaliseRole(role?: string | null) {
  return (role ?? "").toLowerCase().replace(/[\s_-]/g, "");
}

function localDateTime(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function FitSurvey({ segments }: { segments: [number, number][][] }) {
  const map = useMap();
  const key = segments.flat().map(p => p.join(",")).join(";");
  useEffect(() => {
    const points = segments.flat().map(([lng, lat]) => [lat, lng] as [number, number]);
    if (points.length >= 2) map.fitBounds(L.latLngBounds(points), { padding: [35, 35], maxZoom: 15 });
  }, [key, map, segments]);
  return null;
}

function SurveyMap({ survey, geometry }: { survey: any; geometry: any }) {
  const segments: [number, number][][] = geometry?.segments ?? [];
  const verified = survey?.status === "Approved";
  return (
    <MapContainer center={SL_CENTER} zoom={7} className="h-full w-full" scrollWheelZoom>
      <TileLayer
        url="https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png"
        attribution='&copy; OpenStreetMap contributors, Tiles courtesy of HOT'
      />
      <FitSurvey segments={segments} />
      {segments.map((segment, index) => (
        <Polyline
          key={index}
          positions={segment.map(([lng, lat]) => [lat, lng])}
          pathOptions={{ color: verified ? "#15803d" : "#d97706", weight: 5, opacity: 0.9 }}
        >
          <Tooltip sticky>{survey?.roadName} · segment {index + 1}</Tooltip>
        </Polyline>
      ))}
    </MapContainer>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls = status === "Approved" ? "bg-emerald-100 text-emerald-700"
    : status === "Ready for Review" ? "bg-blue-100 text-blue-700"
      : status === "Rejected" ? "bg-red-100 text-red-700"
        : "bg-amber-100 text-amber-700";
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{status}</span>;
}

export function RoadSurveyWorkspace({ onOpenTrackerHistory }: { onOpenTrackerHistory: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const canReview = ["admin", "projectmanager"].includes(normaliseRole(user?.role));
  const [showRoadForm, setShowRoadForm] = useState(false);
  const [showSurveyForm, setShowSurveyForm] = useState(false);
  const [selectedSurveyId, setSelectedSurveyId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const now = new Date();
  const [roadForm, setRoadForm] = useState({
    name: "", districtId: "", startLocation: "", endLocation: "",
    interventionType: "AVDP Feeder Road", surfaceType: "Unknown",
    projectStatus: "Planned", plannedLengthKm: "", contractorName: "", notes: "",
  });
  const [surveyForm, setSurveyForm] = useState({
    roadId: "", vehicleId: "", purpose: "baseline", surveyorName: user?.fullName ?? "",
    startedAt: localDateTime(new Date(now.getTime() - 2 * 60 * 60_000)),
    endedAt: localDateTime(now), fieldNotes: "",
  });

  const roadsQuery = useQuery({ queryKey: ["roads"], queryFn: listRoads });
  const surveysQuery = useQuery({
    queryKey: ["road-surveys", statusFilter],
    queryFn: () => listRoadSurveys({ status: statusFilter || undefined }),
  });
  const districtsQuery = useQuery({ queryKey: ["districts"], queryFn: listDistricts });
  const vehiclesQuery = useQuery({ queryKey: ["vehicles", "road-surveys"], queryFn: () => listVehicles(1, 200) });
  const geometryQuery = useQuery({
    queryKey: ["road-survey-geometry", selectedSurveyId],
    queryFn: () => getRoadSurveyGeometry(selectedSurveyId!),
    enabled: selectedSurveyId != null,
  });

  const roads = roadsQuery.data ?? [];
  const surveys = surveysQuery.data ?? [];
  const selectedSurvey = surveys.find((s: any) => s.id === selectedSurveyId) ?? null;
  // One road may be surveyed repeatedly. Official coverage uses the latest
  // approved survey for each road, never the sum of repeat observations.
  const approvedKm = useMemo(() => Math.round(roads
    .reduce((sum: number, road: any) => sum + Number(road.approvedKm ?? 0), 0) * 10) / 10, [roads]);
  const awaitingReview = surveys.filter((s: any) => s.status === "Ready for Review").length;
  const districtCount = new Set(roads.map((r: any) => r.districtId)).size;

  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ["roads"] }),
    qc.invalidateQueries({ queryKey: ["road-surveys"] }),
  ]);

  const roadMutation = useMutation({
    mutationFn: () => createRoad({ ...roadForm, districtId: Number(roadForm.districtId), plannedLengthKm: roadForm.plannedLengthKm || undefined }),
    onSuccess: async road => {
      await refresh();
      setRoadForm(f => ({ ...f, name: "", startLocation: "", endLocation: "", plannedLengthKm: "", contractorName: "", notes: "" }));
      setSurveyForm(f => ({ ...f, roadId: String(road.id) }));
      setShowRoadForm(false);
      toast({ title: "Road registered", description: `${road.roadCode} is ready for a GPS survey.` });
    },
    onError: (error: Error) => toast({ title: "Could not register road", description: error.message, variant: "destructive" }),
  });
  const surveyMutation = useMutation({
    mutationFn: () => createRoadSurvey({
      ...surveyForm,
      roadId: Number(surveyForm.roadId), vehicleId: Number(surveyForm.vehicleId),
      startedAt: new Date(surveyForm.startedAt).toISOString(), endedAt: new Date(surveyForm.endedAt).toISOString(),
    }),
    onSuccess: async survey => {
      await refresh();
      setSelectedSurveyId(Number(survey.id));
      setShowSurveyForm(false);
      toast({ title: "Survey processed", description: `${survey.surveyCode}: ${survey.surveyedLengthKm} km across ${survey.segmentCount} continuous segment(s).` });
    },
    onError: (error: Error) => toast({ title: "Could not create survey", description: error.message, variant: "destructive" }),
  });
  const submitMutation = useMutation({
    mutationFn: submitRoadSurvey,
    onSuccess: refresh,
    onError: (error: Error) => toast({ title: "Could not submit survey", description: error.message, variant: "destructive" }),
  });
  const reviewMutation = useMutation({
    mutationFn: ({ id, decision, reason }: { id: number; decision: "Approved" | "Rejected"; reason?: string }) => reviewRoadSurvey(id, decision, reason),
    onSuccess: async data => { await refresh(); toast({ title: `Survey ${data.status.toLowerCase()}` }); },
    onError: (error: Error) => toast({ title: "Review failed", description: error.message, variant: "destructive" }),
  });

  function rejectSurvey(id: number) {
    const reason = window.prompt("Enter the reason this survey must be corrected:");
    if (reason?.trim()) reviewMutation.mutate({ id, decision: "Rejected", reason: reason.trim() });
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Road Mapping"
        subtitle="Register AVDP roads, convert bounded tracker windows into clean survey segments, then review before reporting."
        actions={<div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onOpenTrackerHistory}><Clock3 className="mr-1.5 h-3.5 w-3.5" />Tracker history</Button>
          <Button size="sm" variant="outline" onClick={() => setShowRoadForm(v => !v)}><Plus className="mr-1.5 h-3.5 w-3.5" />Register road</Button>
          <Button size="sm" onClick={() => setShowSurveyForm(v => !v)} disabled={!roads.length}><Route className="mr-1.5 h-3.5 w-3.5" />New survey</Button>
        </div>}
      />

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <strong>Reporting safeguard:</strong> tracker history is unverified. Only approved survey sessions contribute to official surveyed kilometres.
      </div>

      {showRoadForm && <Card>
        <CardHeader className="pb-3"><div className="flex items-center"><CardTitle className="text-base">Register a road</CardTitle><Button className="ml-auto" variant="ghost" size="icon" onClick={() => setShowRoadForm(false)}><X className="h-4 w-4" /></Button></div></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1"><Label>Road name *</Label><Input value={roadForm.name} onChange={e => setRoadForm({ ...roadForm, name: e.target.value })} placeholder="e.g. Tikonko–Senehun Feeder Road" /></div>
          <div className="space-y-1"><Label>District *</Label><select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={roadForm.districtId} onChange={e => setRoadForm({ ...roadForm, districtId: e.target.value })}><option value="">Select district</option>{(districtsQuery.data ?? []).map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
          <div className="space-y-1"><Label>Start location *</Label><Input value={roadForm.startLocation} onChange={e => setRoadForm({ ...roadForm, startLocation: e.target.value })} /></div>
          <div className="space-y-1"><Label>End location *</Label><Input value={roadForm.endLocation} onChange={e => setRoadForm({ ...roadForm, endLocation: e.target.value })} /></div>
          <div className="space-y-1"><Label>Intervention</Label><select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={roadForm.interventionType} onChange={e => setRoadForm({ ...roadForm, interventionType: e.target.value })}>{["AVDP Feeder Road", "AVDP Access Road", "Existing Feeder Road", "Other"].map(v => <option key={v}>{v}</option>)}</select></div>
          <div className="space-y-1"><Label>Project status</Label><select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={roadForm.projectStatus} onChange={e => setRoadForm({ ...roadForm, projectStatus: e.target.value })}>{["Planned", "Under Construction", "Completed", "Operational", "Suspended"].map(v => <option key={v}>{v}</option>)}</select></div>
          <div className="space-y-1"><Label>Planned length (km)</Label><Input type="number" min="0" step="0.001" value={roadForm.plannedLengthKm} onChange={e => setRoadForm({ ...roadForm, plannedLengthKm: e.target.value })} /></div>
          <div className="space-y-1"><Label>Contractor</Label><Input value={roadForm.contractorName} onChange={e => setRoadForm({ ...roadForm, contractorName: e.target.value })} /></div>
          <div className="space-y-1 sm:col-span-2 lg:col-span-3"><Label>Notes</Label><Textarea rows={2} value={roadForm.notes} onChange={e => setRoadForm({ ...roadForm, notes: e.target.value })} /></div>
          <div className="flex items-end"><Button className="w-full" disabled={roadMutation.isPending || !roadForm.name || !roadForm.districtId || !roadForm.startLocation || !roadForm.endLocation} onClick={() => roadMutation.mutate()}>{roadMutation.isPending ? "Saving…" : "Save road"}</Button></div>
        </CardContent>
      </Card>}

      {showSurveyForm && <Card>
        <CardHeader className="pb-3"><div className="flex items-center"><CardTitle className="text-base">Create tracker survey</CardTitle><Button className="ml-auto" variant="ghost" size="icon" onClick={() => setShowSurveyForm(false)}><X className="h-4 w-4" /></Button></div></CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1"><Label>Registered road *</Label><select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={surveyForm.roadId} onChange={e => setSurveyForm({ ...surveyForm, roadId: e.target.value })}><option value="">Select road</option>{roads.map((r: any) => <option key={r.id} value={r.id}>{r.roadCode} · {r.name}</option>)}</select></div>
          <div className="space-y-1"><Label>Tracker vehicle *</Label><select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={surveyForm.vehicleId} onChange={e => setSurveyForm({ ...surveyForm, vehicleId: e.target.value })}><option value="">Select vehicle</option>{((vehiclesQuery.data as any)?.data ?? []).map((v: any) => <option key={v.id} value={v.id}>{v.plateNumber}{!v.gpsDeviceId ? " · no tracker linked" : ""}</option>)}</select></div>
          <div className="space-y-1"><Label>Purpose</Label><select className="h-9 w-full rounded-md border bg-background px-3 text-sm" value={surveyForm.purpose} onChange={e => setSurveyForm({ ...surveyForm, purpose: e.target.value })}>{[["baseline","Baseline"],["construction_progress","Construction progress"],["completion","Completion"],["inspection","Inspection"],["accessibility","Accessibility"]].map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div className="space-y-1"><Label>Surveyor *</Label><Input value={surveyForm.surveyorName} onChange={e => setSurveyForm({ ...surveyForm, surveyorName: e.target.value })} /></div>
          <div className="space-y-1"><Label>Start time *</Label><Input type="datetime-local" value={surveyForm.startedAt} onChange={e => setSurveyForm({ ...surveyForm, startedAt: e.target.value })} /></div>
          <div className="space-y-1"><Label>End time *</Label><Input type="datetime-local" value={surveyForm.endedAt} onChange={e => setSurveyForm({ ...surveyForm, endedAt: e.target.value })} /></div>
          <div className="space-y-1 sm:col-span-2"><Label>Field notes</Label><Input value={surveyForm.fieldNotes} onChange={e => setSurveyForm({ ...surveyForm, fieldNotes: e.target.value })} placeholder="Weather, access constraints, construction activity…" /></div>
          <div className="sm:col-span-2 lg:col-span-4 flex justify-end"><Button disabled={surveyMutation.isPending || !surveyForm.roadId || !surveyForm.vehicleId || !surveyForm.surveyorName || !surveyForm.startedAt || !surveyForm.endedAt} onClick={() => surveyMutation.mutate()}>{surveyMutation.isPending ? <><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Processing tracker points…</> : "Process survey"}</Button></div>
        </CardContent>
      </Card>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          ["Registered roads", roads.length, Map], ["Approved km", approvedKm, Ruler],
          ["Survey sessions", surveys.length, Route], ["Awaiting review", awaitingReview, ClipboardCheck],
          ["Districts", districtCount, MapPin],
        ].map(([label, value, Icon]: any) => <Card key={label}><CardContent className="flex items-center gap-3 p-3"><div className="rounded-lg bg-emerald-50 p-2"><Icon className="h-4 w-4 text-emerald-700" /></div><div><p className="text-xl font-bold leading-none">{value}</p><p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p></div></CardContent></Card>)}
      </div>

      <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="min-h-[520px]">
          <CardHeader className="pb-2"><div className="flex items-center gap-2"><CardTitle className="text-sm">Survey sessions</CardTitle><select className="ml-auto h-8 rounded-md border bg-background px-2 text-xs" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="">All statuses</option>{["Draft", "Ready for Review", "Approved", "Rejected"].map(v => <option key={v}>{v}</option>)}</select></div></CardHeader>
          <CardContent className="space-y-2">
            {surveysQuery.isLoading ? Array.from({ length: 4 }).map((_, i) => <Skeleton className="h-24" key={i} />)
              : !surveys.length ? <div className="py-12 text-center text-sm text-muted-foreground"><Route className="mx-auto mb-2 h-8 w-8 opacity-30" />No survey sessions yet.<br />Register a road, then select its tracker time window.</div>
                : surveys.map((survey: any) => <button key={survey.id} onClick={() => setSelectedSurveyId(Number(survey.id))} className={`w-full rounded-lg border p-3 text-left transition-colors ${selectedSurveyId === survey.id ? "border-emerald-500 bg-emerald-50/60" : "hover:bg-muted/50"}`}><div className="flex items-start gap-2"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{survey.roadName}</p><p className="text-[10px] font-mono text-muted-foreground">{survey.surveyCode}</p></div><StatusBadge status={survey.status} /></div><div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-muted-foreground"><span>{survey.plateNumber ?? "No vehicle"}</span><span>{Number(survey.surveyedLengthKm ?? 0).toFixed(2)} km</span><span>{survey.segmentCount} segment(s)</span><span>{new Date(survey.startedAt).toLocaleDateString("en-GB")}</span></div>{survey.qualityStatus !== "Good" && <p className="mt-2 flex items-center gap-1 text-[10px] text-amber-700"><AlertTriangle className="h-3 w-3" />{survey.qualityStatus}</p>}</button>)}
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <div className="h-[520px]">
            {!selectedSurvey ? <div className="flex h-full flex-col items-center justify-center bg-muted/20 text-muted-foreground"><Map className="mb-3 h-10 w-10 opacity-25" /><p className="font-medium">Select a survey to inspect its cleaned route</p><p className="mt-1 text-xs">Disconnected GPS sections are never joined by straight lines.</p></div>
              : geometryQuery.isLoading ? <Skeleton className="h-full w-full rounded-none" />
                : geometryQuery.error ? <div className="flex h-full items-center justify-center p-6 text-center text-sm text-destructive">{(geometryQuery.error as Error).message}</div>
                  : <SurveyMap survey={selectedSurvey} geometry={geometryQuery.data} />}
          </div>
          {selectedSurvey && <div className="space-y-3 border-t p-4"><div className="flex flex-wrap items-start gap-3"><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h3 className="font-semibold">{selectedSurvey.roadName}</h3><StatusBadge status={selectedSurvey.status} /></div><p className="text-xs text-muted-foreground">{selectedSurvey.startLocation} → {selectedSurvey.endLocation} · {selectedSurvey.districtName}</p></div><div className="flex flex-wrap gap-2">{["Draft", "Rejected"].includes(selectedSurvey.status) && <Button size="sm" variant="outline" onClick={() => submitMutation.mutate(Number(selectedSurvey.id))}><Send className="mr-1.5 h-3.5 w-3.5" />Submit for review</Button>}{selectedSurvey.status === "Ready for Review" && canReview && <><Button size="sm" onClick={() => reviewMutation.mutate({ id: Number(selectedSurvey.id), decision: "Approved" })}><CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Approve</Button><Button size="sm" variant="destructive" onClick={() => rejectSurvey(Number(selectedSurvey.id))}>Reject</Button></>}</div></div><div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4"><div><p className="text-muted-foreground">Surveyed</p><p className="font-semibold">{Number(selectedSurvey.surveyedLengthKm ?? 0).toFixed(3)} km</p></div><div><p className="text-muted-foreground">Accepted points</p><p className="font-semibold">{selectedSurvey.acceptedPointCount} / {selectedSurvey.rawPointCount}</p></div><div><p className="text-muted-foreground">Segments / gaps</p><p className="font-semibold">{selectedSurvey.segmentCount} / {selectedSurvey.gapCount}</p></div><div><p className="text-muted-foreground">Average speed</p><p className="font-semibold">{selectedSurvey.averageSpeedKmh ?? "—"} km/h</p></div></div><p className="text-[11px] text-muted-foreground">{selectedSurvey.processingNotes}</p></div>}
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Road register</CardTitle></CardHeader>
        <CardContent>{roadsQuery.isLoading ? <Skeleton className="h-28" /> : !roads.length ? <p className="py-6 text-center text-sm text-muted-foreground">No roads registered.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2">Code / road</th><th>District</th><th>Route</th><th>Intervention</th><th>Status</th><th>Planned km</th><th>Surveys</th><th>Approved km</th></tr></thead><tbody>{roads.map((road: any) => <tr key={road.id} className="border-b last:border-0"><td className="py-3"><p className="font-medium">{road.name}</p><p className="font-mono text-[10px] text-muted-foreground">{road.roadCode}</p></td><td>{road.districtName}</td><td>{road.startLocation} → {road.endLocation}</td><td>{road.interventionType}</td><td>{road.projectStatus}</td><td>{road.plannedLengthKm ?? "—"}</td><td>{road.surveyCount}</td><td className="font-semibold text-emerald-700">{Number(road.approvedKm ?? 0).toFixed(2)}</td></tr>)}</tbody></table></div>}</CardContent>
      </Card>
    </div>
  );
}
