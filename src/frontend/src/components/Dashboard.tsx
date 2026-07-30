import { useEffect, useState } from "react";
import { useBackendActor } from "../lib/useBackend";
import { SummaryBar } from "./SummaryBar";
import { PaymentsLedger } from "./PaymentsLedger";
import { ProjectsBar } from "./ProjectsBar";
import { ExpensesTable } from "./ExpensesTable";
import { TopBar } from "./TopBar";

export function Dashboard({ onHome, onNavigate, currentModule }: { onHome: () => void; onNavigate: (m: string) => void; currentModule: string }) {
  const actor = useBackendActor();

  const [myRole, setMyRole] = useState<string>("read");
  const [payments, setPayments] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterProject, setFilterProject] = useState<string | null>(null);
  const [ksefSentMap, setKsefSentMap] = useState<Record<string, boolean>>({});

  const reload = async () => {
    if (!actor) return;
    const [p, pr, e, ksef] = await Promise.all([
      actor.listMyAdvancePayments(),
      actor.listMyProjects(),
      actor.listMyExpenses(),
      actor.listExpenseKsefSent(),
    ]);
    setPayments(p);
    setProjects(pr);
    setExpenses(e);
    const ksefMap: Record<string, boolean> = {};
    for (const [id, sent] of ksef as any[]) {
      ksefMap[String(id)] = sent;
    }
    setKsefSentMap(ksefMap);
    setLoading(false);
  };

  useEffect(() => {
    reload();
    if (actor) {
      actor.getCallerRole().then((r: any) => {
        if (r && r.length > 0) setMyRole(Object.keys(r[0])[0]);
      });
    }
  }, [actor]);

  useEffect(() => {
    if (!actor) return;
    const interval = setInterval(() => {
      reload();
    }, 3000);
    return () => clearInterval(interval);
  }, [actor]);

  const toggleField = (id: bigint, method: string) => {
    setExpenses((prev) =>
      prev.map((e) => {
        if (e.id !== id) return e;
        const field = method === "togglePaid" ? "paid" : method === "toggleHasInvoice" ? "hasInvoice" : "confirmed";
        return { ...e, [field]: !e[field] };
      })
    );
    actor[method](id).catch(() => reload());
  };
  const toggleKsef = (id: bigint) => {
    const key = String(id);
    setKsefSentMap((prev) => ({ ...prev, [key]: !prev[key] }));
    actor.toggleKsefSent(id).catch(() => reload());
  };

  const canWrite = myRole === "write" || myRole === "admin";
  const totalReceived = payments.reduce((s: number, p: any) => s + p.amount, 0);
  const totalSpent = expenses
    .filter((e: any) => e.paidBy.trim().toLowerCase() === "marcin")
    .reduce((s: number, e: any) => s + (e.pricePln?.[0] ?? 0), 0);

  if (loading) {
    return <div className="min-h-screen bg-[var(--bg-page)] flex items-center justify-center text-gray-500">Ładowanie...</div>;
  }

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text-primary)]">
      <div className="max-w-[1600px] mx-auto p-6 space-y-6">
        <div className="flex items-center gap-4 pb-2">
          <img src="/bartolini-logo.png" alt="Bartolini Air" className="h-8" />
          <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">Rejestr Faktur</h1>
        </div>
        <TopBar
          currentModule={currentModule}
          onNavigate={onNavigate}
          onHome={onHome}
          actor={actor}
          expenses={expenses}
          payments={payments}
          projects={projects}
          onDataChange={reload}
        />
        <>
          <SummaryBar totalReceived={totalReceived} totalSpent={totalSpent} />
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <PaymentsLedger payments={payments} actor={actor} onChange={reload} canWrite={canWrite} />
              <ProjectsBar
                projects={projects}
                expenses={expenses}
                actor={actor}
                onChange={reload}
                filterProject={filterProject}
                setFilterProject={setFilterProject}
                canWrite={canWrite}
              />
            </div>
            <ExpensesTable
              expenses={expenses}
              projects={projects}
              actor={actor}
              onChange={reload}
              onToggle={toggleField}
              filterProject={filterProject}
              canWrite={canWrite}
              ksefSentMap={ksefSentMap}
              onToggleKsef={toggleKsef}
          />
        </>
      </div>
    </div>
  );
}
