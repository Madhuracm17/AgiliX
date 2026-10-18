// AgiliX demo data — a realistic Scrum project for demos of AI sprint health,
// burnout risk and the MCP tools.
//
//   npm run seed:demo             create (or re-create) the demo project
//   npm run seed:demo -- --remove delete everything the demo created
//
// It ONLY creates/deletes its own records: the project "AgiliX Demo" and users
// with emails ending in @demo.agilix.local. Real projects and users are never
// touched. The demo project is owned by the manager in MCP_USER_EMAIL (or the
// email given with --owner=you@example.com), so it shows up when that manager
// logs in. Demo users can log in with the password printed at the end.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(backendRoot, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const PROJECT_NAME = 'AgiliX Demo';
const DEMO_DOMAIN = '@demo.agilix.local';
const DEMO_PASSWORD = 'Demo@1234';
const REPO = 'Madhuracm17/AgiliX';
const DAY = 86_400_000;

const args = process.argv.slice(2);
const remove = args.includes('--remove');
const ownerEmail = (args.find((a) => a.startsWith('--owner='))?.split('=')[1] ?? process.env.MCP_USER_EMAIL ?? '')
  .trim()
  .toLowerCase();

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/agilix';
await mongoose.connect(uri, { serverSelectionTimeoutMS: 30_000 });
const db = mongoose.connection.db;
const users = db.collection('users');
const projects = db.collection('projects');
const sprints = db.collection('sprints');
const tasks = db.collection('tasks');
const timeEntries = db.collection('timeentries');

/** Deletes the demo project, its sprints, tasks and time, and the demo users. */
async function removeDemo() {
  const old = await projects.find({ name: PROJECT_NAME }).toArray();
  const ids = old.map((p) => p._id);
  const idsAsText = ids.map(String);
  const match = { project: { $in: [...ids, ...idsAsText] } };
  const [t, s, e] = await Promise.all([tasks.deleteMany(match), sprints.deleteMany(match), timeEntries.deleteMany(match)]);
  const p = await projects.deleteMany({ _id: { $in: ids } });
  const u = await users.deleteMany({ email: { $regex: `${DEMO_DOMAIN.replace(/\./g, '\\.')}$` } });
  console.log(
    `Removed: ${p.deletedCount} project, ${s.deletedCount} sprints, ${t.deletedCount} tasks, ` +
      `${e.deletedCount} time entries, ${u.deletedCount} demo users.`,
  );
}

try {
  await removeDemo();
  if (remove) process.exit(0);

  // ---------- Owner (the manager who will see the project) ----------
  if (!ownerEmail) throw new Error('Set MCP_USER_EMAIL in .env, or pass --owner=manager@email');
  const escaped = ownerEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const owner = await users.findOne({ email: { $regex: `^${escaped}$`, $options: 'i' } });
  if (!owner) throw new Error(`No AgiliX account with the email ${ownerEmail}`);
  if (owner.role !== 'manager') throw new Error(`${ownerEmail} must be a manager (it is "${owner.role}")`);

  // ---------- Time helpers (India time, where the team works) ----------
  const istNow = new Date(Date.now() + 5.5 * 3_600_000);
  const today = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate());
  /** A moment `daysAgo` days back at hh:mm India time. */
  const at = (daysAgo, hh, mm = 0) => new Date(today - daysAgo * DAY + (hh * 60 + mm - 330) * 60_000);
  /** Midnight UTC of a day, the way sprint dates are stored. */
  const day = (daysAgo) => new Date(today - daysAgo * DAY);
  const isWeekend = (daysAgo) => [0, 6].includes(new Date(today - daysAgo * DAY).getUTCDay());

  // ---------- Demo team ----------
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const people = [
    { key: 'jovika', name: 'Jovika (demo)', role: 'developer', github: 'Jovika-Sujith' },
    { key: 'punya', name: 'Punya (demo)', role: 'developer', github: 'Punyashreepsj' },
    { key: 'madhura', name: 'Madhura (demo)', role: 'tester', github: 'Madhuracm17' },
  ];
  const ids = {};
  const notes = [];
  for (const person of people) {
    // Do not take a GitHub username that a real account already uses.
    const taken = await users.findOne({
      githubUsername: { $regex: `^${person.github}$`, $options: 'i' },
      email: { $not: new RegExp(`${DEMO_DOMAIN.replace(/\./g, '\\.')}$`) },
    });
    if (taken) notes.push(`${person.github} is already linked to ${taken.email}, so ${person.name} has no GitHub username.`);
    const now = new Date();
    const { insertedId } = await users.insertOne({
      name: person.name,
      email: `${person.key}${DEMO_DOMAIN}`,
      passwordHash: hash,
      role: person.role,
      githubUsername: taken ? '' : person.github,
      createdAt: now,
      updatedAt: now,
    });
    ids[person.key] = insertedId;
  }
  ids.manager = owner._id;

  // ---------- Project ----------
  const created = new Date(today - 40 * DAY);
  const { insertedId: projectId } = await projects.insertOne({
    name: PROJECT_NAME,
    description: 'Demo project for AI sprint health, burnout risk and the MCP tools.',
    owner: owner._id,
    members: [ids.jovika, ids.punya, ids.madhura],
    methodology: 'scrum',
    status: 'active',
    wipLimit: 0,
    githubRepo: REPO,
    createdAt: created,
    updatedAt: new Date(),
  });

  // ---------- Sprints: two finished (velocity history) and one active ----------
  const sprintDoc = (name, goal, startAgo, endAgo, status, extra = {}) => ({
    name,
    project: projectId,
    goal,
    startDate: day(startAgo),
    endDate: day(endAgo),
    status,
    startedAt: status === 'planned' ? null : at(startAgo, 10),
    completedAt: status === 'completed' ? at(endAgo, 18) : null,
    committedStoryPoints: null,
    completedStoryPoints: null,
    snapshot: [],
    teamVelocity: 0,
    createdAt: at(startAgo + 1, 12),
    updatedAt: new Date(),
    ...extra,
  });
  await sprints.insertMany([
    sprintDoc('Sprint 1', 'Login and roles', 36, 23, 'completed', { committedStoryPoints: 29, completedStoryPoints: 24 }),
    sprintDoc('Sprint 2', 'Boards and reports', 22, 9, 'completed', { committedStoryPoints: 27, completedStoryPoints: 25 }),
  ]);
  const { insertedId: sprintId } = await sprints.insertOne(
    sprintDoc('Sprint 3', 'MCP integrations and AI insights', 8, -5, 'active'),
  );
  const sprintStart = at(8, 10);

  // ---------- Tasks in the active sprint ----------
  // [title, type, points, priority, status, assignee, startedDaysAgo, doneDaysAgo, addedAfterStartDaysAgo]
  const plan = [
    ['GitHub MCP client', 'backend', 8, 'high', 'done', 'jovika', 8, 4],
    ['Per-member GitHub activity', 'backend', 5, 'high', 'in_progress', 'jovika', 6, null],
    ['Burnout risk prompt and validator', 'backend', 8, 'high', 'in_progress', 'jovika', 5, null],
    ['Team health panel', 'frontend', 5, 'medium', 'in_progress', 'jovika', 2, null],
    ['Calendar MCP spike', 'feature', 5, 'medium', 'todo', 'jovika', null, null, 3],
    ['Fix late-night timer rounding', 'bug', 2, 'high', 'todo', 'jovika', null, null, 2],
    ['Sprint health service', 'backend', 5, 'high', 'review', 'punya', 5, null],
    ['Kanban flow metrics', 'backend', 3, 'medium', 'done', 'punya', 7, 5],
    ['Dashboard AI card', 'frontend', 2, 'low', 'done', 'punya', 6, 3],
    ['Standup summary', 'feature', 5, 'medium', 'todo', 'punya', null, null],
    ['Test MCP tools end to end', 'feature', 3, 'high', 'in_progress', 'madhura', 3, null],
    ['Regression test: boards', 'bug', 2, 'medium', 'done', 'madhura', 4, 2],
    ['Write demo script', 'feature', 2, 'low', 'todo', 'manager', null, null],
    ['Docker compose', 'database', 3, 'medium', 'todo', null, null, null, 1],
    ['Security review of MCP', 'security', 3, 'high', 'review', 'punya', 4, null],
    ['Seed demo data', 'backend', 2, 'medium', 'done', 'punya', 3, 1],
  ];
  const sprintTasks = plan.map(([title, type, storyPoints, priority, status, who, startedAgo, doneAgo, addedAgo]) => {
    const startedAt = startedAgo != null ? at(startedAgo, 11) : null;
    const completedAt = doneAgo != null ? at(doneAgo, 17) : null;
    const history = [];
    if (startedAt) history.push({ status: 'in_progress', at: startedAt });
    if (status === 'review' || completedAt) history.push({ status: 'review', at: completedAt ?? at(1, 16) });
    if (completedAt) history.push({ status: 'done', at: completedAt });
    return {
      title,
      description: `${title} (demo task).`,
      type,
      status,
      priority,
      storyPoints,
      project: projectId,
      sprint: sprintId,
      assignee: who ? ids[who] : null,
      startedAt,
      completedAt,
      statusHistory: history,
      addedToSprintAt: addedAgo != null ? at(addedAgo, 12) : sprintStart,
      reviewNote: null,
      reviews: [],
      createdAt: at(10, 12),
      updatedAt: new Date(),
    };
  });
  const backlog = ['Google Calendar sign-in', 'AI chat page', 'Deploy to cloud'].map((title, i) => ({
    title,
    description: `${title} (demo backlog item).`,
    type: 'feature',
    status: 'todo',
    priority: i === 0 ? 'high' : 'medium',
    storyPoints: [5, 8, 3][i],
    project: projectId,
    sprint: null,
    assignee: null,
    startedAt: null,
    completedAt: null,
    statusHistory: [],
    addedToSprintAt: null,
    reviewNote: null,
    reviews: [],
    createdAt: at(9, 12),
    updatedAt: new Date(),
  }));
  const inserted = await tasks.insertMany([...sprintTasks, ...backlog]);
  const taskIds = Object.values(inserted.insertedIds);
  const taskOf = (who) => sprintTasks.map((t, i) => [t, taskIds[i]]).filter(([t]) => String(t.assignee) === String(ids[who])).map(([, id]) => id);

  // ---------- Tracked time: one overloaded person, one steady, one light ----------
  const entries = [];
  const add = (who, daysAgo, [h1, m1], [h2, m2]) => {
    const start = at(daysAgo, h1, m1);
    const end = h2 < h1 ? at(daysAgo - 1, h2, m2) : at(daysAgo, h2, m2); // past midnight → next day
    const theirs = taskOf(who);
    entries.push({
      task: theirs[(daysAgo + h1) % theirs.length],
      project: projectId,
      user: ids[who],
      startTime: start,
      endTime: end,
      durationSeconds: Math.round((end - start) / 1000),
      createdAt: start,
      updatedAt: end,
    });
  };
  for (let d = 13; d >= 1; d -= 1) {
    // Jovika: long days, late nights and weekends, 12 days in a row (only day 13 off).
    if (d !== 13) {
      add('jovika', d, [10, 0], [14, 0]);
      add('jovika', d, [15, 0], [20, 30]);
      if (d % 3 !== 0) add('jovika', d, [22, 30], [1, 15]);
    }
    if (!isWeekend(d)) {
      // Punya: steady working hours, weekdays only.
      add('punya', d, [9, 30], [13, 0]);
      add('punya', d, [14, 0], [17, 30]);
      // Madhura: testing in the afternoons.
      add('madhura', d, [14, 0], [16, 30]);
      // Manager: a little hands-on time.
      if (d % 2 === 0) add('manager', d, [16, 0], [17, 0]);
    }
  }
  await timeEntries.insertMany(entries.filter((e) => e.task));

  console.log(`\nCreated "${PROJECT_NAME}" (Scrum, active Sprint 3) owned by ${owner.email}:`);
  console.log(`  ${sprintTasks.length + backlog.length} tasks, ${entries.length} time entries, GitHub repo ${REPO}`);
  console.log(`  Project id: ${projectId}`);
  console.log(`  Demo logins (password ${DEMO_PASSWORD}): ${people.map((p) => `${p.key}${DEMO_DOMAIN}`).join(', ')}`);
  for (const note of notes) console.log(`  Note: ${note}`);
  console.log('\nRemove it any time with:  npm run seed:demo -- --remove');
} catch (error) {
  console.error(`Seeding failed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
