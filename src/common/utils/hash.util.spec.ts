import {
  canonicalHash,
  canonicalJson,
  SHA256_HEX_LENGTH,
  sha256Hex,
} from './hash.util'

describe('hash.util', () => {
  it('calcula SHA-256 según el vector de prueba "abc"', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(sha256Hex(Buffer.from('abc'))).toHaveLength(SHA256_HEX_LENGTH)
  })

  it('ordena las claves de forma recursiva', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 'x' } })).toBe(
      '{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}',
    )
  })

  it('omite claves indefinidas y convierte indefinidos en listas a null', () => {
    expect(canonicalJson({ a: undefined, b: [undefined, 1] })).toBe(
      '{"b":[null,1]}',
    )
    expect(canonicalJson(undefined)).toBe('null')
  })

  it('serializa fechas en ISO 8601', () => {
    expect(canonicalJson({ at: new Date('2026-11-04T10:00:00.000Z') })).toBe(
      '{"at":"2026-11-04T10:00:00.000Z"}',
    )
  })

  it('produce el mismo hash sin importar el orden de las claves', () => {
    expect(canonicalHash({ x: 1, y: [1, 2] })).toBe(
      canonicalHash({ y: [1, 2], x: 1 }),
    )
    expect(canonicalHash({ x: 1 })).not.toBe(canonicalHash({ x: 2 }))
  })
})
