import { Button, EmptyState, Screen } from "@srelens/ui-kit";
import { describe } from "../lib/routes";

export interface PlaceholderProps {
  route: string;
  clusterName?: string;
  /** Display names of the screens that do exist in the new design. */
  ported: string[];
  onOpenInClassic: (route: string) => void;
}

/**
 * What a route renders until its screen is built.
 *
 * A first-class screen, as the parent spec insists: routed, titled with the
 * route's real title, and reachable from the sidebar — because users will find
 * it on their first session, and a blank pane or a thrown error would read as
 * the app being broken rather than the design being unfinished. It says what
 * is not there yet, what is, and offers a way to the classic design at the
 * same place rather than at classic's home. (#305)
 *
 * The list of ported screens is passed in rather than imported, so the kit's
 * gallery and this package's tests do not depend on `apps/desktop`.
 */
export function Placeholder({ route, clusterName, ported, onOpenInClassic }: PlaceholderProps) {
  const info = describe(route, clusterName);
  return (
    <Screen title={info.title} eyebrow={info.sub}>
      <EmptyState
        title={`${info.title} is not in the new design yet`}
        hint={
          ported.length === 0 ? (
            "No screens are in the new design yet. Everything you open here shows this page until its screen is built."
          ) : (
            <>
              In the new design so far:
              <ul className="mt-1 list-inside list-disc text-left">
                {ported.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            </>
          )
        }
        action={
          <Button type="button" variant="secondary" size="sm" onClick={() => onOpenInClassic(route)}>
            Open in classic
          </Button>
        }
      />
    </Screen>
  );
}
