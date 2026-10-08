import { createInterface } from "node:readline"; // ponytail: stdlib
import { db, schema } from "@server/db";
import { revokeAuthSessionsForUser } from "@server/repositories/auth-sessions";
import { updateUserPassword } from "@server/repositories/users";
import { eq } from "drizzle-orm";

const username = (process.argv[2] || "").trim().toLowerCase();
if (!username) {
  console.error("Usage: npm run reset-password <username>");
  process.exit(1);
}

const user = db
  .select()
  .from(schema.users)
  .where(eq(schema.users.username, username))
  .get();
if (!user) {
  console.error(`User "${username}" not found`);
  process.exit(1);
}

const rl = createInterface(process.stdin, process.stdout);
const [password, confirm] = await new Promise<string[]>((resolve) => {
  const lines: string[] = [];
  rl.on("line", (line) => {
    lines.push(line);
    if (lines.length === 1) process.stdout.write("Confirm password: "); // ponytail: inline second prompt
    if (lines.length === 2) {
      rl.close();
      resolve(lines);
    }
  });
  process.stdout.write("New password: ");
});

if (password !== confirm) {
  console.error("Passwords do not match");
  process.exit(1);
}

await updateUserPassword({ id: user.id, password });

await revokeAuthSessionsForUser(user.id);

console.log(`Password reset for ${username}`);
