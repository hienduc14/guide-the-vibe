---
name: gtv
description: Pick work from the team's gtv task board. Use when the user runs /gtv, or asks what to work on next, which tasks are open, or to take a task from the board.
---

# /gtv — pick a task from the board

The team plans work on the gtv task board (priority, due date, assignee). Work from it so the team lead sees
progress without asking.

1. Call `gtv_tasks` (add `mine: true` if the user only wants their own tasks). If the user gave a task id
   (`/gtv bt_…`) skip to step 3.
2. Show the user the list as it came back: id, title, priority, due date, who it is assigned to. Recommend one:
   a task assigned to them first, then the most urgent (priority, then due date). Do not take a task assigned
   to someone else. **Ask the user which one to take** and wait for the answer.
3. Call `gtv_pick_task` with the chosen id. Read its description and notes.
4. Plan the change, then call `gtv_register_task` with the files/symbols you will touch. It links to the
   board task by itself.
5. While working, log decisions and blockers with `gtv_log_work` (`kind` + a one-line `summary` in the team language; not a diary).
6. When done, call `gtv_finish_task` with a 1-3 line `summary`. The task moves to review and to done once the code reaches main.

If the board is empty, say so and offer to register the user's own work with `gtv_register_task` (gtv adds it
to the board).

Messages that start with `[gtv task … assigned to you]` mean a lead gave the user a task: tell the user and ask
whether to start it now.
