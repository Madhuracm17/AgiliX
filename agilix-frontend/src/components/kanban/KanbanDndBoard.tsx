import { useState, type KeyboardEvent, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type DraggableSyntheticListeners,
} from "@dnd-kit/core";
import "./kanban.css";
import TaskCommentsButton from "../collab/TaskCommentsButton";

/**
 * Kanban board with drag-and-drop (B1).
 *
 * Cards are dragged between columns; dropping a card on another column calls
 * `onMove(taskId, columnKey)`. The page owns the task list and the save, so
 * this component only handles the dragging. Works with a mouse, touch (press
 * and hold) and the keyboard (focus a card, Space to pick up, arrows to move,
 * Space to drop, Escape to cancel).
 */

export type KanbanColumn = { key: string; label: string };

type BoardTask = { _id: string; title: string; status: string };

type Props<T extends BoardTask> = {
  columns: KanbanColumn[];
  tasks: T[];
  onMove: (taskId: string, status: string) => void;
  /** WIP limits by column key (e.g. { in_progress: 4 }). 0 or missing = no limit. */
  limits?: Partial<Record<string, number>>;
  /**
   * The content of one card (title, badges, timer…). `overlay` is true for the
   * copy that follows the pointer while dragging; leave out anything that
   * should only exist once per task, like the timer.
   */
  renderCard: (task: T, overlay: boolean) => ReactNode;
  /** Start of the board, column and card class names. Kanban keeps "kanban"; Scrum passes "scrum". */
  classPrefix?: string;
  /** Whether this card can be picked up. Missing = every card. */
  canDrag?: (task: T) => boolean;
  /** Whether the card being dragged may be dropped on this column. Missing = any column. */
  canDrop?: (task: T, status: string) => boolean;
  /** Show the comments button on each card. Missing = shown (Kanban); the Scrum board turns it off. */
  showComments?: boolean;
};

// Mouse: a 6px move starts a drag, so clicks on buttons inside a card still work.
// Touch: press and hold, so the page can still be scrolled with a finger.
const MOUSE = { activationConstraint: { distance: 6 } };
const TOUCH = { activationConstraint: { delay: 200, tolerance: 6 } };

// The column under the pointer; for keyboard drags (no pointer) the column
// the card overlaps most.
const findColumn: CollisionDetection = (args) => {
  const underPointer = pointerWithin(args);
  return underPointer.length > 0 ? underPointer : rectIntersection(args);
};

export default function KanbanDndBoard<T extends BoardTask>({
  columns,
  tasks,
  onMove,
  renderCard,
  limits,
  classPrefix = "kanban",
  canDrag,
  canDrop,
  showComments = true,
}: Props<T>) {
  const sensors = useSensors(
    useSensor(MouseSensor, MOUSE),
    useSensor(TouchSensor, TOUCH),
    useSensor(KeyboardSensor),
  );
  const [activeId, setActiveId] = useState<string | null>(null);

  const activeTask = activeId ? tasks.find((t) => t._id === activeId) ?? null : null;
  const columnLabel = (id: unknown) =>
    columns.find((c) => c.key === id)?.label ?? String(id);
  const taskTitle = (id: unknown) =>
    tasks.find((t) => t._id === id)?.title ?? "Task";

  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveId(String(active.id));
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    if (!over) return;

    const task = tasks.find((t) => t._id === active.id);
    const status = String(over.id);
    if (!task || task.status === status) return;
    if (canDrop && !canDrop(task, status)) return;

    onMove(task._id, status);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={findColumn}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            "To move a task, press Space or Enter. Use the arrow keys to choose a column, then press Space or Enter to drop it, or Escape to cancel.",
        },
        announcements: {
          onDragStart: ({ active }) => `Picked up ${taskTitle(active.id)}.`,
          onDragOver: ({ active, over }) =>
            over
              ? `${taskTitle(active.id)} is over ${columnLabel(over.id)}.`
              : `${taskTitle(active.id)} is not over a column.`,
          onDragEnd: ({ active, over }) =>
            over
              ? `${taskTitle(active.id)} was dropped in ${columnLabel(over.id)}.`
              : `${taskTitle(active.id)} was dropped outside the board. Nothing changed.`,
          onDragCancel: ({ active }) =>
            `Moving ${taskTitle(active.id)} was cancelled. Nothing changed.`,
        },
      }}
    >
      <div className={`${classPrefix}-board`}>
        {columns.map((column) => {
          const columnTasks = tasks.filter((t) => t.status === column.key);
          return (
            <DroppableColumn
              key={column.key}
              column={column}
              count={columnTasks.length}
              limit={limits?.[column.key] ?? 0}
              dragging={activeId !== null}
              draggingFromHere={activeTask?.status === column.key}
              prefix={classPrefix}
              disabled={Boolean(activeTask && canDrop && !canDrop(activeTask, column.key))}
            >
              {columnTasks.length === 0 && (
                <p className={`${classPrefix}-empty`}>
                  {activeId ? "Drop here" : "No tasks here"}
                </p>
              )}
              {columnTasks.map((task) => (
                <DraggableCard
                  key={task._id}
                  id={task._id}
                  prefix={classPrefix}
                  disabled={canDrag ? !canDrag(task) : false}
                >
                  {renderCard(task, false)}
                  {showComments && <TaskCommentsButton taskId={task._id} title={task.title} />}
                </DraggableCard>
              ))}
            </DroppableColumn>
          );
        })}
      </div>

      {/* The copy that follows the pointer while the real card waits, dimmed, in its column. */}
      <DragOverlay dropAnimation={null}>
        {activeTask ? (
          <div className={`${classPrefix}-card kanban-card-overlay`}>{renderCard(activeTask, true)}</div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function DroppableColumn({
  column,
  count,
  limit,
  dragging,
  draggingFromHere,
  prefix,
  disabled,
  children,
}: {
  column: KanbanColumn;
  count: number;
  /** WIP limit; 0 = none. */
  limit: number;
  dragging: boolean;
  /** The card being dragged started in this column (so dropping here changes nothing). */
  draggingFromHere: boolean;
  /** Start of the class names ("kanban" or "scrum"). */
  prefix: string;
  /** The card being dragged cannot be dropped here. */
  disabled: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key, disabled });

  const full = limit > 0 && count >= limit;
  const over = limit > 0 && count > limit;

  const classes = [`${prefix}-column`];
  if (dragging) classes.push("kanban-column-droppable");
  if (isOver) {
    classes.push(full && !draggingFromHere ? "kanban-column-over-full" : "kanban-column-over");
  }
  if (full) classes.push("kanban-column-full");

  return (
    <div ref={setNodeRef} className={classes.join(" ")}>
      <div className={`${prefix}-column-header`}>
        <span>{column.label}</span>
        <span
          className={`${prefix}-column-count${full ? " kanban-column-count-full" : ""}`}
          title={limit > 0 ? `WIP limit: ${limit}` : undefined}
        >
          {limit > 0 ? `${count} / ${limit}` : count}
        </span>
      </div>
      {limit > 0 && full && (
        <p className="kanban-wip-note" role="status">
          {over
            ? `Over the limit of ${limit}. Finish tasks before starting new ones.`
            : `At the limit of ${limit}. Finish a task before starting another.`}
        </p>
      )}
      <div className={`${prefix}-column-body`}>{children}</div>
    </div>
  );
}

function DraggableCard({
  id,
  prefix,
  disabled,
  children,
}: {
  id: string;
  prefix: string;
  /** The card cannot be picked up (it stays in place and is not draggable). */
  disabled: boolean;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, disabled });
  const { onKeyDown, ...pointerListeners } = (listeners ?? {}) as NonNullable<DraggableSyntheticListeners>;

  // Space/Enter on a button inside the card (e.g. the timer) must press that
  // button, not pick up the card, so only key presses on the card itself count.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onKeyDown?.(event);
  };

  return (
    <div
      ref={setNodeRef}
      className={`${prefix}-card${disabled ? "" : " kanban-card-draggable"}${isDragging ? " kanban-card-dragging" : ""}`}
      {...attributes}
      {...pointerListeners}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>
  );
}
