import sqlite3, { Database } from 'sqlite3'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { app } from 'electron'
import { sampleCategories, sampleTemplates, samplePrompts, assignCategoryIds } from './sample-data'

let database: Database | null = null

export const getDatabasePath = (): string => {
  const userDataPath = app.getPath('userData')
  if (!existsSync(userDataPath)) {
    mkdirSync(userDataPath, { recursive: true })
  }
  const dbPath = join(userDataPath, 'prompt-studio.db')
  return dbPath
}

export const initDatabase = (): Promise<Database> => {
  return new Promise((resolve, reject) => {
    if (database) {
      return resolve(database)
    }

    const dbPath = getDatabasePath()

    database = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('Error opening database:', err)
        return reject(err)
      }
      
      // Enable WAL mode for better concurrency and durability
      database!.run('PRAGMA journal_mode=WAL;', (pragmaErr) => {
        if (pragmaErr) {
          console.warn('Could not enable WAL mode:', pragmaErr)
        }
        
        // Enable foreign keys
        database!.run('PRAGMA foreign_keys=ON;', (fkErr) => {
          if (fkErr) {
            console.warn('Could not enable foreign keys:', fkErr)
          }
          
          // Set synchronous mode to FULL for data integrity
          database!.run('PRAGMA synchronous=FULL;', (syncErr) => {
            if (syncErr) {
              console.warn('Could not set synchronous mode:', syncErr)
            }
            
            createTables()
              .then(() => resolve(database!))
              .catch(reject)
          })
        })
      })
    })
  })
}

const createTables = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (!database) return reject(new Error('O banco de dados não foi inicializado'))

    const tables = [
      // Settings table
      `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // Categories table
      `CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        color TEXT DEFAULT '#007acc',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,

      // Templates table
      `CREATE TABLE IF NOT EXISTS templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        content TEXT NOT NULL,
        variables TEXT, -- JSON array of variable names
        category_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (category_id) REFERENCES categories (id)
      )`,

      // Prompts table
      `CREATE TABLE IF NOT EXISTS prompts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        description TEXT,
        category_id INTEGER,
        template_id INTEGER,
        tags TEXT, -- JSON array of tags
        is_favorite BOOLEAN DEFAULT FALSE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (category_id) REFERENCES categories (id),
        FOREIGN KEY (template_id) REFERENCES templates (id)
      )`,

      // Prompt versions table for history tracking
      `CREATE TABLE IF NOT EXISTS prompt_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        prompt_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        version_number INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (prompt_id) REFERENCES prompts (id) ON DELETE CASCADE
      )`,

      // Test results table
      `CREATE TABLE IF NOT EXISTS test_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        prompt_id INTEGER NOT NULL,
        input_prompt TEXT NOT NULL,
        response TEXT NOT NULL,
        model TEXT,
        api_endpoint TEXT,
        response_time INTEGER,
        token_usage TEXT, -- JSON object with usage stats
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (prompt_id) REFERENCES prompts (id) ON DELETE CASCADE
      )`,

      // Runs of the "Testes" panel (history and comparison). The tested text is kept even when the
      // prompt it came from is deleted.
      `CREATE TABLE IF NOT EXISTS test_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        prompt_id INTEGER,
        prompt_text TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        temperature REAL,
        max_tokens INTEGER,
        response TEXT,
        error TEXT,
        response_time_ms INTEGER,
        input_tokens INTEGER,
        output_tokens INTEGER,
        source TEXT NOT NULL DEFAULT 'test',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (prompt_id) REFERENCES prompts (id) ON DELETE SET NULL
      )`
    ]

    let completed = 0
    const total = tables.length

    if (total === 0) {
      return resolve()
    }

    tables.forEach((sql, index) => {
      database!.run(sql, (err) => {
        if (err) {
          console.error(`Error creating table ${index}:`, err)
          return reject(err)
        }

        completed++

        if (completed === total) {
          addMissingColumns()
            .then(insertDefaultData)
            .then(resolve)
            .catch(reject)
        }
      })
    })
  })
}

// Columns added after the first release. Each one is added only when missing, so fresh and existing
// databases end up with the same schema.
const COLUMN_MIGRATIONS: ReadonlyArray<{ table: string; column: string; definition: string }> = [
  { table: 'prompts', column: 'is_pinned', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'prompts', column: 'usage_count', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'prompts', column: 'last_used_at', definition: 'DATETIME' },
  // Manual position inside a sequence category (null = not ordered yet)
  { table: 'prompts', column: 'sort_order', definition: 'INTEGER' },
  { table: 'categories', column: 'is_sequence', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'categories', column: 'parent_id', definition: 'INTEGER REFERENCES categories (id)' },
  // "test" or "compare" (tab where the run was executed)
  { table: 'test_runs', column: 'source', definition: "TEXT NOT NULL DEFAULT 'test'" },
]

const addMissingColumns = async (): Promise<void> => {
  const db = database
  if (!db) throw new Error('O banco de dados não foi inicializado')
  const all = <T>(sql: string): Promise<T[]> =>
    new Promise((resolve, reject) => db.all(sql, (err, rows) => (err ? reject(err) : resolve(rows as T[]))))
  const run = (sql: string): Promise<void> =>
    new Promise((resolve, reject) => db.run(sql, (err) => (err ? reject(err) : resolve())))

  for (const { table, column, definition } of COLUMN_MIGRATIONS) {
    const columns = await all<{ name: string }>(`PRAGMA table_info(${table})`)
    if (!columns.some((c) => c.name === column)) {
      await run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    }
  }
}

const insertDefaultData = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (!database) return reject(new Error('O banco de dados não foi inicializado'))

    // Check if this is first time setup by looking at settings
    database.get('SELECT value FROM settings WHERE key = ?', ['first_time_setup_complete'], (err, row: any) => {
      if (err) {
        console.error('Error checking first time setup:', err)
        return reject(err)
      }

      // Once setup is complete, never add data on its own: the user may have deleted the
      // default categories on purpose (sample data only comes back through a factory reset)
      if (row && row.value === 'true') {
        return resolve()
      }

      // This is first time setup - insert sample data
      console.log('First time setup detected - inserting sample data...')
      insertSampleData()
        .then(() => {
          // Mark first time setup as complete
          database!.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', 
            ['first_time_setup_complete', 'true'], 
            (settingErr) => {
              if (settingErr) {
                console.error('Error marking first time setup complete:', settingErr)
                return reject(settingErr)
              }
              console.log('Sample data loaded successfully - first time setup complete')
              resolve()
            }
          )
        })
        .catch(reject)
    })
  })
}

const insertSampleData = (): Promise<void> => {
  return new Promise((resolve, reject) => {
    if (!database) return reject(new Error('O banco de dados não foi inicializado'))

    // Use transaction for all sample data
    database.run('BEGIN TRANSACTION', (beginErr) => {
      if (beginErr) {
        console.error('Error starting sample data transaction:', beginErr)
        return reject(beginErr)
      }

      let totalOperations = 0
      let completedOperations = 0

      // Insert categories first
      const categoriesToInsert = [...sampleCategories]
      totalOperations += categoriesToInsert.length

      const checkComplete = () => {
        completedOperations++
        if (completedOperations === totalOperations) {
          database!.run('COMMIT', (commitErr) => {
            if (commitErr) {
              console.error('Error committing sample data:', commitErr)
              database!.run('ROLLBACK')
              return reject(commitErr)
            }
            resolve()
          })
        }
      }

      // Insert sample categories and get their IDs
      let processedCategories = 0
      const categoryIdMap = new Map<string, number>()

      categoriesToInsert.forEach((category, index) => {
        // First try to insert, then get the ID regardless of whether it was inserted or already existed
        database!.run(
          'INSERT OR IGNORE INTO categories (name, description, color) VALUES (?, ?, ?)',
          [category.name, category.description, category.color],
          function(insertErr) {
            if (insertErr) {
              console.error('Error inserting sample category:', insertErr)
              database!.run('ROLLBACK')
              return reject(insertErr)
            }
            
            // Now get the actual ID for this category
            database!.get(
              'SELECT id FROM categories WHERE name = ?',
              [category.name],
              function(selectErr, row: any) {
                if (selectErr) {
                  console.error('Error getting category ID:', selectErr)
                  database!.run('ROLLBACK')
                  return reject(selectErr)
                }
                
                const categoryId = row.id
                categoryIdMap.set(category.name, categoryId)

                // Insert templates for this category
                const categoryTemplates = sampleTemplates.filter(t => t.category_id === (index + 1))
                totalOperations += categoryTemplates.length

                categoryTemplates.forEach((template) => {
                  database!.run(
                    'INSERT OR IGNORE INTO templates (name, description, content, variables, category_id) VALUES (?, ?, ?, ?, ?)',
                    [template.name, template.description, template.content, JSON.stringify(template.variables), categoryId],
                    (templateErr) => {
                      if (templateErr) {
                        console.error('Error inserting sample template:', templateErr)
                        database!.run('ROLLBACK')
                        return reject(templateErr)
                      }
                      checkComplete()
                    }
                  )
                })

                // Insert prompts for this category
                const categoryPrompts = samplePrompts.filter(p => p.category_id === (index + 1))
                totalOperations += categoryPrompts.length

                categoryPrompts.forEach((prompt) => {
                  database!.run(
                    'INSERT OR IGNORE INTO prompts (title, content, description, category_id, template_id, tags, is_favorite) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [
                      prompt.title,
                      prompt.content,
                      prompt.description || null,
                      categoryId,
                      prompt.template_id || null,
                      JSON.stringify(prompt.tags || []),
                      prompt.is_favorite || false
                    ],
                    function(promptErr) {
                      if (promptErr) {
                        console.error('Error inserting sample prompt:', promptErr)
                        database!.run('ROLLBACK')
                        return reject(promptErr)
                      }
                      
                      // Only create version if prompt was actually inserted (lastID > 0)
                      if (this.lastID > 0) {
                        database!.run(
                          'INSERT INTO prompt_versions (prompt_id, content, version_number) VALUES (?, ?, ?)',
                          [this.lastID, prompt.content, 1],
                          (versionErr) => {
                            if (versionErr) {
                              console.error('Error inserting prompt version:', versionErr)
                            }
                            checkComplete()
                          }
                        )
                      } else {
                        checkComplete()
                      }
                    }
                  )
                })

                checkComplete()
              }
            )
          }
        )
      })
    })
  })
}

// Factory reset function - clears all user data and resets to sample data
export const factoryReset = async (): Promise<void> => {
  if (!database) throw new Error('O banco de dados não foi inicializado')
  const db = database
  const run = (sql: string, params: unknown[] = []): Promise<void> =>
    new Promise((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())))

  console.log('Performing factory reset...')

  // Delete all data in reverse order of dependencies, one statement at a time: firing them
  // in parallel let 'DELETE FROM categories' run before prompts/templates and fail the FOREIGN KEY
  const deleteQueries = [
    'DELETE FROM test_results',
    'DELETE FROM test_runs',
    'DELETE FROM prompt_versions',
    'DELETE FROM prompts',
    'DELETE FROM templates',
    'DELETE FROM categories',
    // Keeps the first time setup flag, and the automatic backup and quick paste settings: resetting the
    // data must not silently turn off backups or take away the global shortcut
    "DELETE FROM settings WHERE key NOT IN ('first_time_setup_complete', 'backup', 'quickPaste')"
  ]

  await run('BEGIN TRANSACTION')
  try {
    for (const query of deleteQueries) {
      await run(query)
    }
    // Reset the first time setup flag so sample data will be loaded again
    await run('UPDATE settings SET value = ? WHERE key = ?', ['false', 'first_time_setup_complete'])
    await run('COMMIT')
  } catch (error) {
    console.error('Error during factory reset:', error)
    await run('ROLLBACK').catch(() => {})
    throw error
  }
  console.log('Factory reset completed successfully')

  // Reload the sample data right away (the flag is now 'false'), so the app
  // doesn't stay empty until the next launch
  await insertDefaultData()
}

export const closeDatabase = (): Promise<void> => {
  return new Promise((resolve) => {
    if (database) {
      database.close((err) => {
        if (err) {
          console.error('Error closing database:', err)
        } else {
          console.log('Database connection closed')
        }
        database = null
        resolve()
      })
    } else {
      resolve()
    }
  })
}