/**
 * Shared MA3 command helpers used by LUA generators.
 *
 * Keeps command string construction in one place so both plugin generators
 * stay in sync when syntax or quoting rules are updated.
 */

function quote(value) {
  return `\\"${String(value).replace(/\\"/g, '\\\\\\"')}\\"`
}

export function cmd(raw) {
  return `  gma.cmd("${raw}")`
}

export function clearAll() {
  return cmd('ClearAll')
}

export function selectGroup(groupName) {
  return cmd(`SelFix Group ${quote(groupName)}`)
}

export function attributeAt(attribute, value) {
  return cmd(`Attribute ${quote(attribute)} at ${value}`)
}

export function attributeEffect(attribute, effectSpec) {
  return cmd(`Attribute ${quote(attribute)} Effect ${effectSpec}`)
}

export function attributePhaser(attribute, phaserId = 1) {
  return cmd(`Attribute ${quote(attribute)} Phaser ${phaserId}`)
}

export function storeSequence(sequenceName, cue = null, mode = null) {
  const cuePart = cue == null ? '' : ` Cue ${cue}`
  const modePart = mode ? ` ${mode}` : ''
  return cmd(`Store Sequence ${quote(sequenceName)}${cuePart}${modePart}`)
}

export function assignSequence(sequenceName, target = null) {
  const targetPart = target ? ` at ${target}` : ''
  return cmd(`Assign Sequence ${quote(sequenceName)}${targetPart}`)
}

export function assignSequenceOption(sequenceName, option) {
  return cmd(`Assign Sequence ${quote(sequenceName)} ${option}`)
}

export function labelSequence(sequenceName, label) {
  return cmd(`Label Sequence ${quote(sequenceName)} ${quote(label)}`)
}

export function labelCue(sequenceName, cue, label) {
  return cmd(`Label Cue ${cue} Sequence ${quote(sequenceName)} ${quote(label)}`)
}

export function cueProperty(sequenceName, cue, propertyName, value) {
  return cmd(`Cue ${cue} Sequence ${quote(sequenceName)} property ${quote(propertyName)} ${value}`)
}

export function applyPreset(presetRef) {
  if (!presetRef) return null
  return cmd(`At Preset ${presetRef}`)
}
