import { screenFor } from "../lib/routes";
import { Placeholder, type PlaceholderProps } from "./Placeholder";

/**
 * One tab's content: the screen registered for its route, or the Placeholder.
 * This is the whole of the router. Everything about which screens exist lives
 * in `screenFor`; this only asks.
 */
export function Body(props: PlaceholderProps) {
  const Screen = screenFor(props.route);
  return Screen ? <Screen route={props.route} /> : <Placeholder {...props} />;
}
