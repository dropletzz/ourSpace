/**
 * ============================================================
 * CONFIGURAZIONE PERSONAGGI - ourSpace
 * ============================================================
 * Questo file contiene tutte le informazioni di configurazione
 * per i 4 personaggi del gioco.
 * 
 * Include:
 * - Statistiche base (PV, danno, velocità)
 * - Configurazione abilità
 * - Configurazione ultimate
 * - Colori e stili per il rendering
 * 
 * Ogni sezione è commentata per spiegare il bilanciamento.
 * ============================================================
 */

import { CharacterType } from './character-system';

// ============================================================
// CONFIGURAZIONE STATISTICHE BASE
// ============================================================

/**
 * Configurazione delle statistiche base per ogni personaggio.
 * Questi valori sono stati scelti per bilanciare i ruoli:
 * - Brawler: Tank con alta salute, basso danno
 * - Sniper: DPS con bassa salute, alto danno
 * - Healer: Supporto con cure passive
 * - Controller: Controllo area con rallentamenti
 */
export const CHARACTER_STATS = {
    brawler: {
        name: "Briar",
        type: "brawler" as CharacterType,
        maxHealth: 500,
        baseDamage: 15,
        moveSpeed: 150,
        width: 50,
        height: 50,
        description: "Il tank corpo a corpo. Alta difesa, basso danno.",
        role: "Tank"
    },
    sniper: {
        name: "Mira",
        type: "sniper" as CharacterType,
        maxHealth: 250,
        baseDamage: 25,
        moveSpeed: 120,
        width: 30,
        height: 30,
        description: "Il DPS a distanza. Bassa vita, alto danno.",
        role: "DPS"
    },
    healer: {
        name: "Lumina",
        type: "healer" as CharacterType,
        maxHealth: 300,
        baseDamage: 10,
        moveSpeed: 140,
        width: 35,
        height: 35,
        description: "Il supporto. Cura gli alleati, non attacca.",
        role: "Support"
    },
    controller: {
        name: "Vortice",
        type: "controller" as CharacterType,
        maxHealth: 350,
        baseDamage: 18,
        moveSpeed: 130,
        width: 40,
        height: 40,
        description: "Il controllo area. Rallenta e blocca i nemici.",
        role: "Controller"
    }
};

// ============================================================
// CONFIGURAZIONE ABILITÀ
// ============================================================

/**
 * Configurazione delle abilità per ogni personaggio.
 * Ogni abilità ha:
 * - name: nome visualizzato
 * - description: descrizione per il giocatore
 * - cooldown: tempo di ricarica in secondi
 * - isPassive: se è un'abilità passiva
 * - effect: tipo di effetto
 */
export const CHARACTER_ABILITIES = {
    brawler: [
        {
            name: "Pelle Dura",
            description: "Riduce il danno ricevuto del 10%",
            cooldown: 0,
            isPassive: true,
            effect: "damageReduction",
            value: 0.1
        },
        {
            name: "Colpo Devastante",
            description: "Infligge 50 danno a un singolo bersaglio",
            cooldown: 3,
            isPassive: false,
            effect: "singleTargetDamage",
            value: 50
        },
        {
            name: "Scudo Temporaneo",
            description: "Crea uno scudo che assorbe 100 danno per 2 secondi",
            cooldown: 8,
            isPassive: false,
            effect: "shield",
            value: 100,
            duration: 2
        },
        {
            name: "Carica",
            description: "Si lancia in avanti, stordendo i nemici colpiti",
            cooldown: 6,
            isPassive: false,
            effect: "charge",
            value: 30,
            stunDuration: 1
        }
    ],
    sniper: [
        {
            name: "Occhio d'Aquila",
            description: "30% probabilità di schivare gli attacchi",
            cooldown: 0,
            isPassive: true,
            effect: "dodge",
            value: 0.3
        },
        {
            name: "Tiro Preciso",
            description: "Il prossimo attacco sarà critico",
            cooldown: 4,
            isPassive: false,
            effect: "criticalStrike",
            value: 2.0
        },
        {
            name: "Distrazione",
            description: "Riduce il danno del nemico del 30% per 3 secondi",
            cooldown: 10,
            isPassive: false,
            effect: "debuff",
            value: 0.3,
            duration: 3
        },
        {
            name: "Bomba Fumogena",
            description: "Crea una zona di nebbia per 4 secondi",
            cooldown: 12,
            isPassive: false,
            effect: "smoke",
            duration: 4
        }
    ],
    healer: [
        {
            name: "Aura Rigenerativa",
            description: "Cura 5 punti vita ogni secondo",
            cooldown: 0,
            isPassive: true,
            effect: "passiveHeal",
            value: 5
        },
        {
            name: "Cura",
            description: "Cura un alleato di 50 punti vita",
            cooldown: 3,
            isPassive: false,
            effect: "heal",
            value: 50
        },
        {
            name: "Barriera",
            description: "Crea una barriera che assorbe 80 danno",
            cooldown: 6,
            isPassive: false,
            effect: "barrier",
            value: 80,
            duration: 3
        },
        {
            name: "Rianimazione",
            description: "Rialza un alleato sconfitto con il 50% di vita",
            cooldown: 15,
            isPassive: false,
            effect: "resurrect",
            value: 0.5
        }
    ],
    controller: [
        {
            name: "Campo di Forza",
            description: "Riduce del 15% la velocità dei nemici vicini",
            cooldown: 0,
            isPassive: true,
            effect: "slowAura",
            value: 0.15
        },
        {
            name: "Gelamento",
            description: "Rallenta tutti i nemici nell'area del 50% per 3 secondi",
            cooldown: 5,
            isPassive: false,
            effect: "areaSlow",
            value: 0.5,
            duration: 3
        },
        {
            name: "Catenaccio",
            description: "Immobilizza un nemico per 2 secondi",
            cooldown: 7,
            isPassive: false,
            effect: "stun",
            duration: 2
        },
        {
            name: "Tempesta",
            description: "Infligge 30 danno a tutti i nemici nell'area",
            cooldown: 8,
            isPassive: false,
            effect: "areaDamage",
            value: 30
        }
    ]
};

// ============================================================
// CONFIGURAZIONE ULTIMATE
// ============================================================

/**
 * Configurazione delle ultimate per ogni personaggio.
 */
export const CHARACTER_ULTIMATES = {
    brawler: {
        name: "Furia del Titano",
        description: "Danno x2, Velocità x1.5, 50% riduzione danno per 5 secondi",
        duration: 5,
        effects: {
            damageMultiplier: 2.0,
            speedMultiplier: 1.5,
            damageReduction: 0.5
        }
    },
    sniper: {
        name: "Colpo del Destino",
        description: "Prossimo colpo causa 100 danno garantiti",
        duration: 3,
        effects: {
            guaranteedDamage: 100,
            cannotDodge: true
        }
    },
    healer: {
        name: "Resurrezione di Massa",
        description: "Cura tutti gli alleati di 100 HP e rimuove i debuff",
        duration: 0,
        effects: {
            healAmount: 100,
            removeDebuffs: true
        }
    },
    controller: {
        name: "Buco Nero",
        description: "Attira i nemici e causa 15 danno/sec per 4 secondi",
        duration: 4,
        effects: {
            damagePerSecond: 15,
            pullEnemies: true
        }
    }
};

// ============================================================
// CONFIGURAZIONE COLORI E STILI
// ============================================================

/**
 * Colori e stili visivi per ogni personaggio.
 * Usati per il rendering nella lobby e in gioco.
 */
export const CHARACTER_STYLES = {
    brawler: {
        primaryColor: "#e53935",    // Rosso
        secondaryColor: "#b71c1c",   // Rosso scuro
        accentColor: "#ffcdd2",      // Rosa chiaro
        outlineColor: "#b71c1c",
        bodyColor: "#d32f2f",
        description: "Tank"
    },
    sniper: {
        primaryColor: "#43a047",     // Verde
        secondaryColor: "#1b5e20",   // Verde scuro
        accentColor: "#c8e6c9",      // Verde chiaro
        outlineColor: "#1b5e20",
        bodyColor: "#388e3c",
        description: "DPS"
    },
    healer: {
        primaryColor: "#1e88e5",     // Blu
        secondaryColor: "#0d47a1",   // Blu scuro
        accentColor: "#bbdefb",      // Blu chiaro
        outlineColor: "#0d47a1",
        bodyColor: "#1976d2",
        description: "Support"
    },
    controller: {
        primaryColor: "#8e24aa",     // Viola
        secondaryColor: "#4a148c",  // Viola scuro
        accentColor: "#e1bee7",      // Viola chiaro
        outlineColor: "#4a148c",
        bodyColor: "#7b1fa2",
        description: "Controller"
    }
};

// ============================================================
// FUNZIONI DI UTILITÀ
// ============================================================

/**
 * Ottiene la lista di tutti i tipi di personaggio disponibili.
 */
export function getCharacterTypes(): CharacterType[] {
    return ["brawler", "sniper", "healer", "controller"];
}

/**
 * Ottiene i nomi dei personaggi.
 */
export function getCharacterNames(): string[] {
    return Object.values(CHARACTER_STATS).map(s => s.name);
}

/**
 * Ottiene le statistiche di un personaggio specifico.
 */
export function getCharacterStats(type: CharacterType) {
    return CHARACTER_STATS[type];
}

/**
 * Ottiene le abilità di un personaggio specifico.
 */
export function getCharacterAbilities(type: CharacterType) {
    return CHARACTER_ABILITIES[type];
}

/**
 * Ottiene la ultimate di un personaggio specifico.
 */
export function getCharacterUltimate(type: CharacterType) {
    return CHARACTER_ULTIMATES[type];
}

/**
 * Ottiene lo stile visivo di un personaggio.
 */
export function getCharacterStyle(type: CharacterType) {
    return CHARACTER_STYLES[type];
}

/**
 * Ottiene il tipo di personaggio dal nome.
 */
export function getCharacterTypeByName(name: string): CharacterType | null {
    for (const [type, stats] of Object.entries(CHARACTER_STATS)) {
        if (stats.name === name) {
            return type as CharacterType;
        }
    }
    return null;
}

/**
 * Verifica se un nome è valido per un personaggio.
 */
export function isValidCharacterName(name: string): boolean {
    return getCharacterTypes().includes(name as CharacterType);
}

// ============================================================
// INFORMAZIONI DI BILANCIAMENTO
// ============================================================

/**
 * Riepilogo del bilanciamento dei personaggi.
 * Questi valori sono stati calcolati per garantire:
 * - Nessun personaggio dominante
 * - Ruoli distinti e utili
 * - Counters naturali tra personaggi
 */
export const BALANCE_SUMMARY = `
=== BILANCIAMENTO PERSONAGGI ===

BRIAR (Brawler) - Tank
- PV: 500 (più alto)
- Dmg: 15 (basso)
- Ruolo: Assorbe danni, prima linea
- Punti forti: Resiste a lungo
- Punti deboli: Non fa molto danno

MIRA (Sniper) - DPS
- PV: 250 (più basso)
- Dmg: 25 (più alto)
- Ruolo: Elimina nemici da distanza
- Punti forti: Uccide velocemente
- Punti deboli: Fragile, deve evitare danni

LUMINA (Healer) - Support
- PV: 300 (medio)
- Dmg: 10 (basso)
- Ruolo: Mantiene in vita i compagni
- Punti forti: Cure continue
- Punti deboli: Non combatte direttamente

VORTICE (Controller) - Controller
- PV: 350 (medio-alto)
- Dmg: 18 (medio)
- Ruolo: Controlla il campo di battaglia
- Punti forti: Rallenta e blocca
- Punti deboli: Danno non eccezionale

=== COUNTERS NATURALI ===
- Sniper > Healer (uccide prima che curi)
- Brawler > Sniper (resiste ai colpi, si avvicina)
- Controller > Controller (chi rallenta prima vince)
- Healer > Brawler (lo tiene in vita più a lungo)
`;