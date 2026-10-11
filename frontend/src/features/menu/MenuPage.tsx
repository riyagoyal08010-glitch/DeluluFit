import { ComingSoon } from "@/components/layout/ComingSoon";
import { DemoTag } from "@/components/layout/DemoTag";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge, PageHeader } from "@/components/ui/Feedback";
import { useDataMode } from "@/features/auth/session";
import { formatLongDate, localIsoDate, MEAL_LABELS } from "@/lib/format";
import { DEMO_MENU } from "@/mocks/demoData";

export function MenuPage() {
  const isDemo = useDataMode() === "demo";
  return (
    <>
      <PageHeader title="Mess menu" description="What your mess plans to serve. Planned meals aren't logged until you log them." />
      {isDemo ? (
        <Card aria-labelledby="menu-day">
          <CardHeader id="menu-day" title={<span className="flex items-center gap-2">{formatLongDate(localIsoDate())}<DemoTag /></span>}
                      description="Sample menu. Items marked “Needs review” came from a photo and haven't been checked yet." />
          <div className="grid gap-3 sm:grid-cols-2">
            {DEMO_MENU.map((m) => (
              <div key={m.meal} className="rounded-control border border-line/70 bg-sheet p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">{MEAL_LABELS[m.meal]}</h3>
                  {m.status === "confirmed" ? <Badge tone="success">Confirmed</Badge> : <Badge tone="warning">Needs review</Badge>}
                </div>
                <ul className="space-y-1 text-sm text-ink-muted">{m.items.map((i) => <li key={i}>{i}</li>)}</ul>
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <ComingSoon feature="Menu upload" plans={[
          "Photograph or upload your hostel's menu; images stay private to your account.",
          "Review the dishes read from the photo, fix mistakes and add anything missed, or type the menu in yourself.",
          "Confirm the menu, browse it by date and meal, and start a meal log from a menu item.",
        ]} />
      )}
    </>
  );
}
