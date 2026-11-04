export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,49}$/
export const USERNAME_RULE_MESSAGE =
  'username debe tener entre 3 y 50 caracteres: minúsculas, números, punto, guion o guion bajo'
export const PASSWORD_MIN_LENGTH = 10
export const PASSWORD_MAX_LENGTH = 128
export const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/
export const PASSWORD_RULE_MESSAGE =
  'la contraseña debe tener entre 10 y 128 caracteres, con al menos una mayúscula, una minúscula y un número'
export const PASSWORD_DESCRIPTION =
  'Entre 10 y 128 caracteres, con mayúscula, minúscula y número. No puede contener el nombre de usuario.'

export function passwordContainsUsername(
  username: string,
  password: string,
): boolean {
  return password.toLowerCase().includes(username.toLowerCase())
}
