
import { useState } from "react";
import type { Assignment } from "../types";

type CalendarProps = {
  assignments: Assignment[];
  onDateSelect: (date: string) => void;
};

export default function Calendar({
  assignments,
  onDateSelect,
}: CalendarProps) {
  const today = new Date();

  const formatDate = (date: Date) =>
    [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");

  const [currentDate, setCurrentDate] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1)
  );

  const [selectedDate, setSelectedDate] = useState(formatDate(today));

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const firstDay = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();

  const monthName = currentDate.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });

  const dateKey = (day: number) =>
    `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const selectedAssignments = assignments.filter(
    a => a.due_date?.slice(0, 10) === selectedDate
  );

  function selectDate(date: string) {
    setSelectedDate(date);
    onDateSelect(date);
  }

  function changeMonth(direction: number) {
    setCurrentDate(new Date(year, month + direction, 1));
  }

  return (
    <section className="calendar-page">
      <div className="calendar-card">
        <div className="calendar-header">
          <button
            type="button"
            onClick={() => changeMonth(-1)}
          >
            ‹
          </button>

          <h2>{monthName}</h2>

          <button
            type="button"
            onClick={() => changeMonth(1)}
          >
            ›
          </button>
        </div>

        <div className="calendar-grid">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => (
            <div className="calendar-weekday" key={day}>
              {day}
            </div>
          ))}

          {Array.from({ length: firstDay }).map((_, i) => (
            <div key={`empty-${i}`} />
          ))}

          {Array.from({ length: totalDays }).map((_, i) => {
            const day = i + 1;
            const date = dateKey(day);

            const dayAssignments = assignments.filter(
              a => a.due_date?.slice(0, 10) === date
            );

            const isToday = formatDate(today) === date;
            const isSelected = selectedDate === date;

            return (
              <button
                type="button"
                key={date}
                className={`calendar-day ${
                  isSelected ? "selected" : ""
                } ${isToday ? "today" : ""}`}
                onClick={() => selectDate(date)}
              >
                <span>{day}</span>

                {dayAssignments.length > 0 && (
                  <small className="calendar-count">
                    {dayAssignments.length} work
                  </small>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="calendar-tasks">
        <h2>Scheduled Work</h2>
        <p className="muted">{selectedDate}</p>

        {selectedAssignments.length === 0 ? (
          <p className="muted">
            No inspections scheduled for this date.
          </p>
        ) : (
          selectedAssignments.map(a => (
            <div className="calendar-task" key={a.id}>
              <h3>{a.title}</h3>

              <p>Location: {a.location}</p>

              <p>
                Assigned to: {a.assignee_name || `Staff #${a.assignee_id}`}
              </p>

              <p>
                Assigned by: {a.created_by_name || "Administrator"}
              </p>

              <p>Priority: {a.priority}</p>

              <span className={`task-status ${(a.status || "assigned").replaceAll("_", " ")}`}>
                {(a.status || "assigned").replaceAll("_", " ")}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
