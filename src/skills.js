import fs from 'fs';
import path from 'path';
import os from 'os';

export class SkillManager {
  constructor(customDir = null) {
    this.skillsDir = customDir || process.env.SKILLS_DIR || path.join(os.homedir(), '.agents', 'skills');
    this.ensureSkillsDir();
  }

  ensureSkillsDir() {
    try {
      if (!fs.existsSync(this.skillsDir)) {
        fs.mkdirSync(this.skillsDir, { recursive: true });
      }
    } catch (e) {
      console.warn(`[Skills] Unable to create skills directory ${this.skillsDir}:`, e.message);
    }
  }

  parseFrontmatter(rawContent) {
    let name = '';
    let description = '';
    let body = rawContent;

    const match = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (match) {
      const yamlBlock = match[1];
      body = match[2];

      const nameMatch = yamlBlock.match(/^name:\s*(.+)$/m);
      if (nameMatch) name = nameMatch[1].trim().replace(/^['"]|['"]$/g, '');

      const descMatch = yamlBlock.match(/^description:\s*(.+)$/m);
      if (descMatch) description = descMatch[1].trim().replace(/^['"]|['"]$/g, '');
    }

    return { name, description, body };
  }

  listSkills() {
    this.ensureSkillsDir();
    if (!fs.existsSync(this.skillsDir)) return [];

    const entries = fs.readdirSync(this.skillsDir, { withFileTypes: true });
    const skills = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillName = entry.name;
      const skillFile = path.join(this.skillsDir, skillName, 'SKILL.md');

      if (fs.existsSync(skillFile)) {
        try {
          const stat = fs.statSync(skillFile);
          const rawContent = fs.readFileSync(skillFile, 'utf8');
          const { name, description } = this.parseFrontmatter(rawContent);

          skills.push({
            id: skillName,
            name: name || skillName,
            description: description || 'No description provided',
            path: skillFile,
            size: stat.size,
            updatedAt: stat.mtime.toISOString()
          });
        } catch (e) {
          // Skip unreadable files
        }
      }
    }

    // Sort by name
    return skills.sort((a, b) => a.name.localeCompare(b.name));
  }

  getSkill(skillId) {
    const safeId = path.basename(skillId);
    const skillFile = path.join(this.skillsDir, safeId, 'SKILL.md');

    if (!fs.existsSync(skillFile)) {
      throw new Error(`Skill "${safeId}" not found at ${skillFile}`);
    }

    const stat = fs.statSync(skillFile);
    const rawContent = fs.readFileSync(skillFile, 'utf8');
    const { name, description, body } = this.parseFrontmatter(rawContent);

    return {
      id: safeId,
      name: name || safeId,
      description: description || '',
      content: rawContent,
      body: body.trim(),
      path: skillFile,
      size: stat.size,
      updatedAt: stat.mtime.toISOString()
    };
  }

  saveSkill(skillId, { name, description, content }) {
    const safeId = path.basename(skillId || name).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    if (!safeId) {
      throw new Error('Invalid skill name/id');
    }

    const targetDir = path.join(this.skillsDir, safeId);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const skillFile = path.join(targetDir, 'SKILL.md');
    let finalContent = content;

    // If content does not have frontmatter, generate it
    if (!content.trim().startsWith('---')) {
      finalContent = `---\nname: ${name || safeId}\ndescription: ${description || ''}\n---\n\n${content.trim()}\n`;
    }

    fs.writeFileSync(skillFile, finalContent, 'utf8');
    const stat = fs.statSync(skillFile);

    return {
      id: safeId,
      name: name || safeId,
      description: description || '',
      content: finalContent,
      path: skillFile,
      size: stat.size,
      updatedAt: stat.mtime.toISOString()
    };
  }

  deleteSkill(skillId) {
    const safeId = path.basename(skillId);
    const targetDir = path.join(this.skillsDir, safeId);

    if (!fs.existsSync(targetDir)) {
      throw new Error(`Skill "${safeId}" not found`);
    }

    fs.rmSync(targetDir, { recursive: true, force: true });
    return { success: true, deleted: safeId };
  }
}

export const skillManager = new SkillManager();
