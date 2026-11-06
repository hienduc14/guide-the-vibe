// Task pairs for the conflict benchmark, on gothinkster/node-express-realworld-example-app (pinned commit).
// Each pair: dev A's task, dev B's task, and what B does instead once it knows about A's change ("adapted",
// applied on top of A's merged work). `truth` is the ground truth when both are done blindly in parallel:
//   text  → git reports a merge conflict
//   logic → git merges cleanly but the merged code no longer typechecks
//   none  → no conflict (a warning here is a false alarm)

import type { TaskResource } from "../../src/shared/types.ts";

export interface Edit {
  file: string;
  /** Exact replacements (every occurrence), applied in order. */
  replace?: [string, string][];
  /** Text appended at the end of the file. */
  append?: string;
  /** New file content. */
  create?: string;
}

export interface Task {
  title: string;
  goal: string;
  resources: TaskResource[];
  edits: Edit[];
}

export interface Scenario {
  id: string;
  title: string;
  truth: "text" | "logic" | "none";
  a: Task;
  b: Task;
  /** B's edits once it knows about A's change, applied on top of A's merged work. */
  adapted: Edit[];
}

const R = "src/app/routes";
const path = (value: string, op: TaskResource["op"] = "modify"): TaskResource => ({ kind: "path", value, op });
const symbol = (value: string, op: TaskResource["op"]): TaskResource => ({ kind: "symbol", value, op });

const followers = (call: string) => `import prisma from '../../../prisma/prisma-client';
import profileMapper from './profile.utils';

export const getFollowers = async (username: string, id?: number) => {
  const user = await prisma.user.findUnique({
    where: { username },
    include: { followedBy: { include: { followedBy: true } } },
  });
  return (user?.followedBy ?? []).map((follower: any) => ${call});
};
`;

const session = (fn: string) => `import { ${fn} } from './auth.service';

export const refreshSession = async (id: number) => {
  const user = await ${fn}(id);
  return { username: user.username, token: user.token };
};
`;

const badge = (body: string) => `import authorMapper from './author.mapper';

export const authorBadge = (author: any, id?: number) => {
  const a = authorMapper(author, id);
${body}
};
`;

const isFollowing = `
export const isFollowing = async (usernamePayload: string, id: number) => {
  const profile = await getProfile(usernamePayload, id);
  return profile.following;
};
`;
const countFollowers = `
export const countFollowers = async (usernamePayload: string) =>
  prisma.user.count({ where: { following: { some: { username: usernamePayload } } } });
`;

export const SCENARIOS: Scenario[] = [
  {
    id: "S1",
    title: "Hai người cùng sửa một dòng (hạn token)",
    truth: "text",
    a: {
      title: "Shorter JWT lifetime",
      goal: "tokens expire after 7 days",
      resources: [path(`${R}/auth/token.utils.ts`)],
      edits: [{ file: `${R}/auth/token.utils.ts`, replace: [["expiresIn: '60d',", "expiresIn: '7d',"]] }],
    },
    b: {
      title: "Add issuer to JWT",
      goal: "tokens carry an issuer; 30 day lifetime",
      resources: [path(`${R}/auth/token.utils.ts`)],
      edits: [{ file: `${R}/auth/token.utils.ts`, replace: [["expiresIn: '60d',", "expiresIn: '30d',\n    issuer: 'conduit',"]] }],
    },
    adapted: [{ file: `${R}/auth/token.utils.ts`, replace: [["expiresIn: '7d',", "expiresIn: '7d',\n    issuer: 'conduit',"]] }],
  },
  {
    id: "S2",
    title: "A đổi chữ ký hàm, B viết code mới gọi hàm đó (khác file)",
    truth: "logic",
    a: {
      title: "profileMapper takes a viewer object",
      goal: "pass the viewer as { id } instead of a bare id",
      resources: [
        path(`${R}/profile/profile.utils.ts`),
        path(`${R}/profile/profile.service.ts`),
        path(`${R}/article/article.service.ts`),
        symbol("profileMapper", "sig_change"),
      ],
      edits: [
        {
          file: `${R}/profile/profile.utils.ts`,
          replace: [
            ["(user: any, id: number | undefined): Profile", "(user: any, viewer?: { id: number }): Profile"],
            ["following: id\n", "following: viewer\n"],
            ["followingUser.id === id)", "followingUser.id === viewer?.id)"],
          ],
        },
        { file: `${R}/profile/profile.service.ts`, replace: [["profileMapper(profile, id)", "profileMapper(profile, id ? { id } : undefined)"]] },
        { file: `${R}/article/article.service.ts`, replace: [["profileMapper(article.author, id)", "profileMapper(article.author, { id })"]] },
      ],
    },
    b: {
      title: "List a user's followers",
      goal: "new getFollowers service",
      resources: [path(`${R}/profile/profile.followers.ts`, "create")],
      edits: [{ file: `${R}/profile/profile.followers.ts`, create: followers("profileMapper(follower, id)") }],
    },
    adapted: [{ file: `${R}/profile/profile.followers.ts`, create: followers("profileMapper(follower, id ? { id } : undefined)") }],
  },
  {
    id: "S3",
    title: "A đổi tên hàm, B gọi tên cũ (khác file)",
    truth: "logic",
    a: {
      title: "Rename getCurrentUser to getUserById",
      goal: "clearer service naming",
      resources: [path(`${R}/auth/auth.service.ts`), path(`${R}/auth/auth.controller.ts`), symbol("getCurrentUser", "rename")],
      edits: [
        { file: `${R}/auth/auth.service.ts`, replace: [["export const getCurrentUser =", "export const getUserById ="]] },
        { file: `${R}/auth/auth.controller.ts`, replace: [["getCurrentUser", "getUserById"]] },
      ],
    },
    b: {
      title: "Session refresh helper",
      goal: "refreshSession returns a fresh token",
      resources: [path(`${R}/auth/session.utils.ts`, "create")],
      edits: [{ file: `${R}/auth/session.utils.ts`, create: session("getCurrentUser") }],
    },
    adapted: [{ file: `${R}/auth/session.utils.ts`, create: session("getUserById") }],
  },
  {
    id: "S4",
    title: "Cùng file, khác hàm (git tự gộp được)",
    truth: "none",
    a: {
      title: "Stronger password hashing",
      goal: "bcrypt cost 12 on sign-up",
      resources: [path(`${R}/auth/auth.service.ts`)],
      edits: [
        {
          file: `${R}/auth/auth.service.ts`,
          replace: [["const hashedPassword = await bcrypt.hash(password, 10);", "const hashedPassword = await bcrypt.hash(password, 12);"]],
        },
      ],
    },
    b: {
      title: "Case-insensitive login email",
      goal: "lower-case the email on login",
      resources: [path(`${R}/auth/auth.service.ts`)],
      edits: [
        {
          file: `${R}/auth/auth.service.ts`,
          replace: [["const email = userPayload.email?.trim();", "const email = userPayload.email?.trim().toLowerCase();"]],
        },
      ],
    },
    adapted: [
      { file: `${R}/auth/auth.service.ts`, replace: [["const email = userPayload.email?.trim();", "const email = userPayload.email?.trim().toLowerCase();"]] },
    ],
  },
  {
    id: "S5",
    title: "Hai việc không liên quan",
    truth: "none",
    a: {
      title: "More popular tags",
      goal: "return 20 tags",
      resources: [path(`${R}/tag/tag.service.ts`)],
      edits: [{ file: `${R}/tag/tag.service.ts`, replace: [["take: 10,", "take: 20,"]] }],
    },
    b: {
      title: "Comment count on articles",
      goal: "articles expose commentsCount",
      resources: [path(`${R}/article/article.mapper.ts`)],
      edits: [
        {
          file: `${R}/article/article.mapper.ts`,
          replace: [
            ["favoritesCount: article.favoritedBy.length,", "favoritesCount: article.favoritedBy.length,\n  commentsCount: article.comments?.length ?? 0,"],
          ],
        },
      ],
    },
    adapted: [
      {
        file: `${R}/article/article.mapper.ts`,
        replace: [
          ["favoritesCount: article.favoritedBy.length,", "favoritesCount: article.favoritedBy.length,\n  commentsCount: article.comments?.length ?? 0,"],
        ],
      },
    ],
  },
  {
    id: "S6",
    title: "Hai người cùng thêm hàm vào cuối một file",
    truth: "text",
    a: {
      title: "isFollowing helper",
      goal: "check whether the viewer follows a user",
      resources: [path(`${R}/profile/profile.service.ts`)],
      edits: [{ file: `${R}/profile/profile.service.ts`, append: isFollowing }],
    },
    b: {
      title: "Follower count",
      goal: "count a user's followers",
      resources: [path(`${R}/profile/profile.service.ts`)],
      edits: [{ file: `${R}/profile/profile.service.ts`, append: countFollowers }],
    },
    adapted: [{ file: `${R}/profile/profile.service.ts`, append: countFollowers }],
  },
  {
    id: "S7",
    title: "Cùng vùng code đã đăng ký (phân trang bài viết)",
    truth: "text",
    a: {
      title: "Cap article page size",
      goal: "default 20, max 100 articles per page",
      resources: [path(`${R}/article/**`)],
      edits: [{ file: `${R}/article/article.service.ts`, replace: [["take: Number(query.limit) || 10,", "take: Math.min(Number(query.limit) || 20, 100),"]] }],
    },
    b: {
      title: "Reject negative offsets",
      goal: "offset never below 0",
      resources: [path(`${R}/article/**`)],
      edits: [
        {
          file: `${R}/article/article.service.ts`,
          replace: [
            [
              "skip: Number(query.offset) || 0,\n    take: Number(query.limit) || 10,",
              "skip: Math.max(Number(query.offset) || 0, 0),\n    take: Number(query.limit) || 10,",
            ],
          ],
        },
      ],
    },
    adapted: [{ file: `${R}/article/article.service.ts`, replace: [["skip: Number(query.offset) || 0,", "skip: Math.max(Number(query.offset) || 0, 0),"]] }],
  },
  {
    id: "S8",
    title: "A bỏ một trường trong kết quả trả về, B đọc trường đó (khác file)",
    truth: "logic",
    a: {
      title: "Author payload without following",
      goal: "following is computed by the client",
      resources: [path(`${R}/article/author.mapper.ts`)],
      edits: [
        {
          file: `${R}/article/author.mapper.ts`,
          replace: [["  following: id\n    ? author?.followedBy.some((followingUser: Partial<User>) => followingUser.id === id)\n    : false,\n", ""]],
        },
      ],
    },
    b: {
      title: "Author badge",
      goal: "show (following) next to followed authors",
      resources: [path(`${R}/article/author.badge.ts`, "create")],
      edits: [{ file: `${R}/article/author.badge.ts`, create: badge("  return a.following ? `${a.username} (following)` : a.username;") }],
    },
    adapted: [
      {
        file: `${R}/article/author.badge.ts`,
        create: badge("  const following = author?.followedBy?.some((u: any) => u.id === id);\n  return following ? `${a.username} (following)` : a.username;"),
      },
    ],
  },
];
