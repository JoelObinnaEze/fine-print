import type { Item, WorldState } from "../../../../packages/engine/src/index.js";

function itemLabel(item: Item): string {
  return `${item.id} ${item.material}${item.eligible ? ", eligible" : ", ineligible"}`;
}

function visibleItemsAt(state: WorldState, x: number, y: number): readonly Item[] {
  return state.items.filter((item) => {
    if (item.locus.kind === "floor") {
      return item.locus.cell.x === x && item.locus.cell.y === y;
    }
    if (item.locus.kind === "input") {
      return state.stations.input.x === x && state.stations.input.y === y;
    }
    if (item.locus.kind === "hopper") {
      return state.stations.hopper.x === x && state.stations.hopper.y === y;
    }
    if (item.locus.kind === "processed") {
      return state.stations.processor.x === x && state.stations.processor.y === y;
    }
    if (item.locus.kind === "rejected") {
      return state.stations.reject.x === x && state.stations.reject.y === y;
    }
    return false;
  });
}

export function Depot({ state }: { readonly state: WorldState }) {
  const stationAt = (x: number, y: number) =>
    Object.entries(state.stations).find(
      ([, position]) => position.x === x && position.y === y,
    )?.[0];
  const carriedItem = state.items.find((item) => item.locus.kind === "inventory");

  return (
    <section className="depot-panel" aria-label="Bottle Return depot">
      <div className="depot-heading">
        <h2>3D Bottle Return replay</h2>
        <p className="tick-stamp">
          Tick <output aria-label="Current tick">{state.tick}</output> / {state.horizon}
        </p>
      </div>
      <p className="sr-only">
        Worker at column {state.worker.position.x + 1}, row {state.worker.position.y + 1}.
        {carriedItem ? ` Carrying ${itemLabel(carriedItem)}.` : " Inventory empty."}
      </p>
      <div className="depot-stage" aria-hidden="true">
        <div className="depot-grid">
          {Array.from({ length: state.width * state.height }, (_, index) => {
            const x = index % state.width;
            const y = Math.floor(index / state.width);
            const station = stationAt(x, y);
            const items = visibleItemsAt(state, x, y);
            const hasWorker = state.worker.position.x === x && state.worker.position.y === y;
            return (
              <div
                className={`depot-cell${station ? " depot-cell--station" : ""}`}
                key={`${x}-${y}`}
              >
                {station && <span className={`station station--${station}`}>{station}</span>}
                <div className="item-stack">
                  {items.map((item) => (
                    <span className={`item item--${item.material}`} key={item.id}>
                      {item.id}
                    </span>
                  ))}
                </div>
                {hasWorker && (
                  <span className="worker">
                    <span>agent</span>
                    {carriedItem && <b>{carriedItem.id}</b>}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="depot-legend" aria-label="Depot legend">
        <span><i className="legend-dot legend-dot--worker" />Agent</span>
        <span><i className="legend-dot legend-dot--eligible" />Eligible item</span>
        <span><i className="legend-dot legend-dot--ineligible" />Ineligible item</span>
      </div>
    </section>
  );
}
