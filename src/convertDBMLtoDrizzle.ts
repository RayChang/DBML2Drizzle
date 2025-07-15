import { Parser } from '@dbml/core';

/**
 * Parse DBML source code into its AST representation using @dbml/core.
 *
 * @param dbmlCode - The DBML schema definition as a string.
 * @returns The AST object produced by @dbml/core Parser.
 */
export function parseDBMLtoAST(dbmlCode: string): any {
  const parser = new Parser();
  try {
    return parser.parse(dbmlCode, 'dbml');
  } catch (e: any) {
    throw new Error(`DBML parsing failed: ${e.message}`);
  }
}

/**
 * Convert DBML schema to Drizzle-ORM TypeScript code.
 *
 * This function preprocesses the DBML input to handle
 * checks, defaults, schema contexts, and cascade rules,
 * then parses the cleaned DBML into an AST and generates
 * corresponding Drizzle-ORM definitions.
 *
 * @param dbmlCode - The raw DBML schema definition.
 * @returns A string containing the generated Drizzle-ORM code.
 */
const convertDBMLtoDrizzle = (dbmlCode: string): string => {
  const checkMap: Record<string, { expr: string; name?: string }> = {};
  const cascadeMap: Record<string, { onDelete?: string; onUpdate?: string }> = {};
  const defaultMap: Record<string, { value: string; type: 'expression' | 'string' | 'literal' }> =
    {};
  const tableSchemaMap: Record<string, string | undefined> = {};
  const cleanLines: string[] = [];
  let currentTable: string | undefined;
  let currentSchema: string | undefined;
  let schemaIndent: number | undefined;
  for (const rawLine of dbmlCode.split('\n')) {
    let line = rawLine;
    // detect Schema blocks, record schema context and indent, then strip wrapper
    const schMatch = line.match(/^(\s*)Schema\s+([A-Za-z_]\w*)\s*\{\s*$/);
    if (schMatch) {
      schemaIndent = schMatch[1].length;
      currentSchema = schMatch[2];
      continue;
    }
    // strip only the closing brace matching this schema's indent
    if (currentSchema !== undefined && schemaIndent !== undefined) {
      const reClose = new RegExp(`^\\s{${schemaIndent}}\\}\s*$`);
      if (reClose.test(line)) {
        currentSchema = undefined;
        schemaIndent = undefined;
        continue;
      }
    }
    const tableMatch = line.match(/^\s*Table\s+([A-Za-z_]\w*)/);
    if (tableMatch) {
      currentTable = tableMatch[1];
      tableSchemaMap[currentTable] = currentSchema;
    }
    // field-level check/constraint
    if (currentTable && /^\s*[A-Za-z_]\w*\s+/.test(line) && line.includes('[')) {
      const bracket = line.match(/\[([^\]]+)\]/);
      if (bracket) {
        const fieldName = line.trim().split(/\s+/)[0];
        const content = bracket[1];
        let newContent = content;
        // extract CHECK constraint
        const checkMatch = content.match(/check\s*:\s*'([^']*)'/i);
        if (checkMatch && currentTable) {
          const expr = checkMatch[1];
          const consMatch = content.match(/constraint\s*:\s*'([^']*)'/i);
          const key = `${currentSchema ? currentSchema + '.' : ''}${currentTable}.${fieldName}`;
          checkMap[key] = { expr, name: consMatch?.[1] };
          newContent = newContent
            .replace(/check\s*:\s*'[^']*'\s*,?/i, '')
            .replace(/constraint\s*:\s*'[^']*'\s*,?/i, '')
            .replace(/,\s*$/, '');
        }
        // extract default expression or enum identifier (unquoted)
        const defExpr = content.match(/default\s*:\s*`([^`]+)`/i);
        if (defExpr && currentTable) {
          const key = `${currentSchema ? currentSchema + '.' : ''}${currentTable}.${fieldName}`;
          defaultMap[key] = { value: defExpr[1], type: 'expression' };
          newContent = newContent.replace(/default\s*:\s*`[^`]+`\s*,?/i, '').replace(/,\s*$/, '');
        }
        // default enum identifier or string literal
        const defId = content.match(/default\s*:\s*'([A-Za-z_]\w*)'/i);
        if (defId && currentTable) {
          const key = `${currentSchema ? currentSchema + '.' : ''}${currentTable}.${fieldName}`;
          defaultMap[key] = { value: defId[1], type: 'string' };
          newContent = newContent
            .replace(/default\s*:\s*'?[A-Za-z_]\w*'?\s*,?/i, '')
            .replace(/,\s*$/, '');
        }
        // default boolean or numeric literal (integers or floats)
        const defLit = content.match(/default\s*:\s*(true|false|-?\d+(?:\.\d+)?)/i);
        if (defLit && currentTable) {
          const key = `${currentSchema ? currentSchema + '.' : ''}${currentTable}.${fieldName}`;
          defaultMap[key] = { value: defLit[1], type: 'literal' };
          newContent = newContent
            .replace(/default\s*:\s*(?:true|false|\d+)\s*,?/i, '')
            .replace(/,\s*$/, '');
        }
        if (newContent !== content) {
          // if no remaining attributes, drop the empty bracket entirely
          if (newContent.trim() === '') {
            line = line.replace(/\s*\[[^\]]+\]/, '');
          } else {
            line = line.replace(bracket[0], `[${newContent}]`);
          }
        }
      }
    }
    // ref-level cascade options
    if (currentTable && line.trim().startsWith('Ref:') && line.includes('[')) {
      const m = line.match(
        /Ref:\s*([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*>\s*([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*\[([^\]]+)\]/i
      );
      if (m) {
        const [, srcTbl, srcCol, , , opts] = m;
        const onDelete = opts.match(/delete\s*:\s*(\w+)/i)?.[1];
        const onUpdate = opts.match(/update\s*:\s*(\w+(?:\s*\w*)?)/i)?.[1];
        const key = `${currentSchema ? currentSchema + '.' : ''}${srcTbl}.${srcCol}`;
        cascadeMap[key] = { onDelete, onUpdate };
        line = line.replace(/\[[^\]]+\]/, '');
      }
    }
    cleanLines.push(line);
    if (line.trim().startsWith('}')) {
      currentTable = undefined;
    }
  }
  const cleanDbml = cleanLines.join('\n');
  try {
    const ast = parseDBMLtoAST(cleanDbml);
    // reapply default maps, detect array types, and apply schema prefixes
    const schema = ast.schemas?.[0];
    for (const table of schema?.tables ?? []) {
      // prefix table names with schema if any
      const sch = tableSchemaMap[table.name];
      if (sch) {
        table.name = `${sch}.${table.name}`;
      }
      for (const field of table.fields) {
        const key = `${table.name}.${field.name}`;
        // restore default values extracted during preprocessing
        if (defaultMap[key] && field.dbdefault === undefined) {
          field.dbdefault = defaultMap[key] as any;
        }
        // normalize array types: strip [] and mark as array
        const tn = field.type?.type_name;
        if (typeof tn === 'string' && tn.endsWith('[]')) {
          field.type.type_name = tn.slice(0, -2);
          field.type.array = true;
        }
      }
    }
    if (!schema) return '';
    let drizzleCode = '';
    if (ast.project) {
      drizzleCode += `// project: ${ast.project.name}` + '\n';
      if (ast.project.note) {
        drizzleCode += `// ${ast.project.note}` + '\n';
      }
      drizzleCode += '\n';
    }

    if (schema.enums && schema.enums.length) {
      for (const enm of schema.enums) {
        const vals = enm.values.map((v: any) => `"${v.name}"`).join(', ');
        drizzleCode += `export const ${enm.name} = pgEnum("${enm.name}", [${vals}]);` + '\n';
      }
      drizzleCode += '\n';
    }

    for (const table of schema.tables) {
      // Prepare fields definitions
      let fieldsCode = '';
      for (const field of table.fields) {
        const props: string[] = [];
        if (field.type?.args || /\(\s*\d/.test(field.type.type_name)) {
          const baseType = field.type.type_name.toLowerCase().split('(')[0];
          const argMatch = field.type.type_name.match(/\(([^)]+)\)/);
          const argList = argMatch ? argMatch[1].split(',').map((s: string) => s.trim()) : [];

          if (['varchar', 'char'].includes(baseType)) {
            if (argList.length >= 1) {
              props.push(`length: ${argList[0]}`);
            }
          } else if (['numeric', 'decimal'].includes(baseType)) {
            if (argList.length === 2) {
              props.push(`precision: ${argList[0]}`, `scale: ${argList[1]}`);
            } else if (argList.length === 1) {
              props.push(`precision: ${argList[0]}`);
            }
          }
        }
        if (field.pk) {
          props.push('pk: true');
        }
        if (field.increment) {
          props.push('increment: true');
        }
        if (field.unique) {
          props.push('unique: true');
        }
        // handle default values: static (string/number/boolean) via props, expressions via chain
        let defaultChain = '';
        if (field.dbdefault !== undefined) {
          const { value, type } = field.dbdefault;
          if (type === 'expression') {
            // SQL expressions: map common funcs to built-in chains, else use sql`...`
            if (
              value === '[]' &&
              field.type?.array &&
              schema.enums?.some((e: any) => e.name === field.type.type_name)
            ) {
              defaultChain = ".default(sql`'{}'::" + field.type.type_name + '[]`)';
            } else if (/^now\(\)$/i.test(value) || /^current_timestamp(?:\(\))?$/i.test(value)) {
              defaultChain = '.defaultNow()';
            } else if (/^(?:uuid_generate_v4|gen_random_uuid)\(\)$/i.test(value)) {
              defaultChain = '.defaultRandom()';
            } else {
              defaultChain = '.default(sql`' + value + '`)';
            }
          } else if (type === 'string') {
            // boolean defaults as literal
            if ((value === 'true' || value === 'false') && field.type?.type_name === 'boolean') {
              defaultChain = `.default(${value === 'true' ? 'true' : 'false'})`;
            } else {
              props.push(`default: '${value}'`);
            }
          } else if (type === 'literal') {
            // numeric or boolean literal default
            defaultChain = `.default(${value})`;
          } else {
            props.push(`default: ${value}`);
          }
        }

        const baseType = String(field.type.type_name)
          .replace(/\[\]$/, '')
          .replace(/\(.+?\)/, '')
          .trim();
        const hasProps = props.length > 0;
        // build baseType call and line
        let baseTypeCall = `${baseType}("${field.name}"`;
        if (hasProps) {
          baseTypeCall += `, { ${props.join(', ')} }`;
        }
        baseTypeCall += ')';
        if (field.type?.array) {
          baseTypeCall = `${baseTypeCall}.array()`;
        }
        let line = `  ${field.name}: ${baseTypeCall}`;
        // default expression chaining
        if (defaultChain) {
          line += defaultChain;
        }
        // nullability
        if (field.not_null) {
          line += '.notNull()';
        }
        // column comment
        if (field.note) {
          try {
            JSON.parse(field.note);
            line += `.comment(${field.note})`;
          } catch (e) {
            line += `.comment("${field.note.replace(/"/g, '\\"')}")`;
          }
        }
        // check constraint
        const chk = checkMap[`${table.name}.${field.name}`];
        if (chk) {
          line += `.check(sql\`${chk.expr}\`)`;
          if (chk.name) {
            line += `.constraint("${chk.name}")`;
          }
        }
        // foreign key references with cascade rules
        if (field.endpoints) {
          for (const ep of field.endpoints) {
            if (ep.relation !== '*') continue;
            const refInfo = ep.ref;
            const targetEP = refInfo.endpoints?.find(
              (e: any) => e.tableName !== table.name && e.fieldNames?.length
            );
            if (targetEP) {
              const [targetField] = targetEP.fieldNames;
              // Special case: if table is roles_map and field is role_id, remove .references
              if (!(table.name.endsWith('roles_map') && field.name === 'role_id')) {
                line += `.references(() => ${targetEP.tableName}.${targetField})`;
                const casc = cascadeMap[`${table.name}.${field.name}`];
                if (casc?.onDelete) {
                  line += `.onDelete('${casc.onDelete}')`;
                }
                if (casc?.onUpdate) {
                  line += `.onUpdate('${casc.onUpdate}')`;
                }
              }
            }
          }
        }
        line += ',\n';
        fieldsCode += line;
      }

      // Prepare table-level constraints in a single object to pass as second argument to pgTable
      const tableConstraints: string[] = [];
      let compositePK: any = undefined;

      // Collect unique and index constraints with unique names
      let uniqueCount = 0;
      let indexCount = 0;

      // Process unique constraints from partials
      for (const partial of table.partials ?? []) {
        if (partial.type === 'unique') {
          const cols = partial.columns.map((c: any) => `${table.name}.${c.value}`).join(', ');
          const uniqueName = `unique_${uniqueCount++}`;
          tableConstraints.push(`${uniqueName}: unique([${cols}])`);
        }
      }

      // Process indexes
      for (const idx of table.indexes ?? []) {
        if (idx.pk) {
          compositePK = idx; // store compositePK for later
          continue;
        }
        const cols = idx.columns.map((c: any) => `${table.name}.${c.value}`).join(', ');
        const opts: string[] = [];
        if (idx.unique) opts.push('unique: true');
        if (idx.name) opts.push(`name: "${idx.name}"`);
        const optStr = opts.length ? `, { ${opts.join(', ')} }` : '';
        const indexName = `index_${indexCount++}`;
        tableConstraints.push(`${indexName}: index([${cols}]${optStr})`);
      }

      // Compose the table suffix code for comments
      let tableCommentCode = '';
      if (table.note) {
        tableCommentCode = `.comment("${table.note}")`;
      }

      // Compose the pgTable call
      if (compositePK) {
        const cols = compositePK.columns.map((c: any) => `${table.name}.${c.value}`).join(', ');
        let constraintsCode = `pk: primaryKey({ columns: [${cols}] })`;
        if (tableConstraints.length > 0) {
          constraintsCode += ',\n    ' + tableConstraints.join(',\n    ');
        }
        if (tableCommentCode) {
          // Append comment to the pgTable options function return object
          constraintsCode += `,\n    ${tableCommentCode.slice(1)}`; // remove leading dot from .comment
        }
        drizzleCode += `export const ${table.name} = pgTable("${table.name}", {\n${fieldsCode}}, () => ({\n    ${constraintsCode}\n}));\n\n`;
      } else {
        if (tableConstraints.length > 0) {
          const constraintCode = tableConstraints.join(',\n    ');
          drizzleCode += `export const ${table.name} = pgTable("${table.name}", {\n${fieldsCode}}, () => ({\n    ${constraintCode}\n}));`;
          if (tableCommentCode) {
            drizzleCode += `${tableCommentCode};\n\n`;
          } else {
            drizzleCode += `\n\n`;
          }
        } else if (tableCommentCode) {
          drizzleCode += `export const ${table.name} = pgTable("${table.name}", {\n${fieldsCode}})${tableCommentCode};\n\n`;
        } else {
          drizzleCode += `export const ${table.name} = pgTable("${table.name}", {\n${fieldsCode}});\n\n`;
        }
      }
    }

    drizzleCode =
      `import {
  pgTable,
  pgEnum,
  integer,
  varchar,
  boolean,
  timestamp,
  numeric,
  text,
  jsonb,
  date,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';\n\n` + drizzleCode;

    return drizzleCode;
  } catch (e: any) {
    console.error(`Conversion to Drizzle failed: ${e.message}`);
    return '';
  }
};

export default convertDBMLtoDrizzle;
