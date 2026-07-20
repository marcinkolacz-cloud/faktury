import { useEffect, useState } from "react";
import { useBackendActor } from "../lib/useBackend";
import { SummaryBar } from "./SummaryBar";
import { PaymentsLedger } from "./PaymentsLedger";
import { ProjectsBar } from "./ProjectsBar";
import { ExpensesTable } from "./ExpensesTable";
import { ImportExport } from "./ImportExport";

export function Dashboard() {
  const actor = useBackendActor();
  const [payments, setPayments] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterProject, setFilterProject] = useState<string | null>(null);

  const reload = async () => {
    if (!actor) return;
    const [p, pr, e] = await Promise.all([
      actor.listMyAdvancePayments(),
      actor.listMyProjects(),
      actor.listMyExpenses(),
    ]);
    setPayments(p);
    setProjects(pr);
    setExpenses(e);
    setLoading(false);
  };

  useEffect(() => {
    reload();
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

  const totalReceived = payments.reduce((s: number, p: any) => s + p.amount, 0);
  const totalSpent = expenses.reduce((s: number, e: any) => s + (e.pricePln?.[0] ?? 0), 0);

  if (loading) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-500">Ładowanie...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="max-w-[1600px] mx-auto p-6 space-y-6">
        <div className="border-b border-gray-200 pb-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Rejestr Faktur</h1>
          <ImportExport expenses={expenses} payments={payments} projects={projects} actor={actor} onChange={reload} />
        </div>
        <SummaryBar totalReceived={totalReceived} totalSpent={totalSpent} />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <PaymentsLedger payments={payments} actor={actor} onChange={reload} />
          <ProjectsBar
            projects={projects}
            expenses={expenses}
            actor={actor}
            onChange={reload}
            filterProject={filterProject}
            setFilterProject={setFilterProject}
          />
        </div>
        <ExpensesTable
          expenses={expenses}
          projects={projects}
          actor={actor}
          onChange={reload}
          onToggle={toggleField}
          filterProject={filterProject}
        />
      </div>
    </div>
  );
}
