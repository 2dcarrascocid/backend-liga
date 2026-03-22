/**
 * ADF - Base Skill Contract
 * Todas las skills heredan de esta clase.
 * Define la interfaz estándar: execute(), validate(), describe()
 */

export class Skill {
  constructor(name, version = '1.0.0') {
    if (!name) throw new Error('Skill must have a name');
    this.name = name;
    this.version = version;
    this.domain = 'generic';

    /**
     * Contrato formal de la skill.
     * input: campos requeridos para ejecutar
     * output: campos garantizados en la respuesta
     * rules: DO / DON'T declarativos
     * checklist: validaciones obligatorias antes de marcar como completa
     */
    this.contract = {
      input: [],   // [{ name, required, type, description }]
      output: [],  // [{ name, type, description }]
      rules: {
        do: [],
        dont: [],
      },
      checklist: [],
    };
  }

  /**
   * Método principal que toda skill debe implementar.
   * @param {import('./task_schema.js').Task} task
   * @returns {Promise<import('./task_schema.js').SkillResult>}
   */
  async execute(task) {
    throw new Error(`Skill "${this.name}" must implement execute(task)`);
  }

  /**
   * Valida que el input del task cumpla el contrato de la skill.
   * Lanza SkillContractError si falla.
   */
  validateInput(input) {
    const errors = [];

    for (const field of this.contract.input) {
      if (!field.required) continue;

      const value = input[field.name];
      const isMissing =
        value === undefined || value === null || value === '';

      if (isMissing) {
        errors.push({
          field: field.name,
          message: `"${field.name}" is required by skill "${this.name}"`,
        });
        continue;
      }

      if (field.type && typeof value !== field.type && !Array.isArray(value)) {
        errors.push({
          field: field.name,
          message: `"${field.name}" must be of type ${field.type}`,
        });
      }
    }

    if (errors.length > 0) {
      const err = new Error(`Contract violation in skill "${this.name}"`);
      err.code = 'SKILL_CONTRACT_ERROR';
      err.details = errors;
      throw err;
    }
  }

  /**
   * Retorna la descripción completa de la skill (autodocumentación).
   */
  describe() {
    return {
      name: this.name,
      version: this.version,
      domain: this.domain,
      contract: this.contract,
    };
  }
}
