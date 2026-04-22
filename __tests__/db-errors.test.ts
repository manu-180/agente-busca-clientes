import { esErrorDuplicadoLead, esErrorOnConflictSinIndice } from '@/lib/db-errors'

describe('esErrorOnConflictSinIndice', () => {
  it('42P10', () => {
    expect(esErrorOnConflictSinIndice({ code: '42P10' })).toBe(true)
  })
  it('mensaje on conflict', () => {
    expect(
      esErrorOnConflictSinIndice({
        message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification',
      })
    ).toBe(true)
  })
  it('otro error', () => {
    expect(esErrorOnConflictSinIndice({ code: '22P02' })).toBe(false)
  })
})

describe('esErrorDuplicadoLead', () => {
  it('23505', () => {
    expect(esErrorDuplicadoLead({ code: '23505' })).toBe(true)
  })
  it('LEAD_DUPLICADO', () => {
    expect(esErrorDuplicadoLead({ message: "LEAD_DUPLICADO: teléfono 54911" })).toBe(true)
  })
  it('duplicate key', () => {
    expect(esErrorDuplicadoLead({ message: 'duplicate key value violates unique constraint' })).toBe(true)
  })
  it('no duplicado', () => {
    expect(esErrorDuplicadoLead({ code: 'PGRST102' })).toBe(false)
  })
})
