import { useEffect, useState } from "react";
import { useBackendActor } from "../lib/useBackend";
import { WarehouseItemsTable } from "./WarehouseItemsTable";
import { TopBar } from "./TopBar";
import { InfoTip } from "./InfoTip";
import { StockMovementsPanel } from "./StockMovementsPanel";

export function WarehouseModule({ onHome, onNavigate, currentModule }: { onHome: () => void; onNavigate: (m: string) => void; currentModule: string }) {
  const actor = useBackendActor();
  const [items, setItems] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [myRole, setMyRole] = useState<string>("read");

  const reload = async () => {
    if (!actor) return;
    const [it, mv, pr, cat] = await Promise.all([
      actor.listWarehouseItems(),
      actor.listStockMovements(),
      actor.listMyProjects(),
      actor.listWarehouseCategories(),
    ]);
    setItems(it);
    setMovements(mv);
    setProjects(pr);
    setCategories(cat);
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

  const canWrite = myRole === "write" || myRole === "admin";

  if (loading) {
    return <div className="min-h-screen bg-[var(--bg-page)] flex items-center justify-center text-gray-500">Ładowanie...</div>;
  }

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text-primary)]">
      <div className="max-w-[1600px] mx-auto p-6 space-y-6">
        <div className="flex items-center gap-4 pb-2">
          <img src="/bartolini-logo.png" alt="Bartolini Air" className="h-8" />
          <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">Magazyn</h1>
          <InfoTip text="Stany magazynowe, przyjęcia i wydania do projektów. Kolumny FNPT2/Trainer pokazują, do jakiego typu symulatora pasuje dana część." />
        </div>
        <TopBar currentModule={currentModule} onNavigate={onNavigate} onHome={onHome} actor={actor} />
        <WarehouseItemsTable items={items} categories={categories} projects={projects} movements={movements} actor={actor} onChange={reload} canWrite={canWrite} />
        <StockMovementsPanel items={items} movements={movements} projects={projects} actor={actor} onChange={reload} canWrite={canWrite} />
      </div>
    </div>
  );
}
