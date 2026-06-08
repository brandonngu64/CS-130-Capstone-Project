import { getCharacterSpriteUrl } from './CharacterSprites';
import type { PlayerRenderState } from './RollbackPhysicsGame';
import {
  DEFAULT_GAME_MODE,
  KOABLE_DURATION_TICKS,
  SMASH_MAX_DAMAGE_PCT,
  type GameMode,
} from './constants';

const PIP_DISPLAY_THRESHOLD = 4;

function colorToCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

/**
 * Classic: ratio = health/maxHealth, so green at full HP and red at 0.
 * Smash: ratio = 1 - damagePct/SMASH_MAX_DAMAGE_PCT, so green at 0% and red at 300%.
 */
function healthColor(ratio: number): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  const r = Math.round(255 * clamped + 139 * (1 - clamped));
  const g = Math.round(255 * clamped);
  const b = Math.round(255 * clamped);
  return `rgb(${r},${g},${b})`;
}

export class SmashHud {
  private readonly element: HTMLElement;
  private koBarEnabled = false;
  private gameMode: GameMode = DEFAULT_GAME_MODE;

  constructor(parent: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'smash-hud';
    this.element.dataset.visible = 'false';
    parent.appendChild(this.element);
  }

  setVisible(visible: boolean): void {
    this.element.dataset.visible = visible ? 'true' : 'false';
  }

  setKoBarEnabled(enabled: boolean): void {
    this.koBarEnabled = enabled;
  }

  setGameMode(mode: GameMode): void {
    this.gameMode = mode;
  }

  update(players: readonly PlayerRenderState[], localPlayerId: string): void {
    if (players.length === 0) {
      this.element.innerHTML = '';
      return;
    }

    const sorted = [...players].sort((a, b) => {
      if (a.id === localPlayerId) return -1;
      if (b.id === localPlayerId) return 1;
      return a.id.localeCompare(b.id);
    });

    this.element.innerHTML = sorted.map((p) => this.renderCard(p)).join('');
  }

  destroy(): void {
    this.element.remove();
  }

  private renderKoBar(player: PlayerRenderState): string {
    if (!this.koBarEnabled || player.eliminated) return '';

    const koable = player.koableTicksRemaining > 0;
    const inKnockback = player.knockbackTicksRemaining > 0;

    if (!koable && !inKnockback) return '';

    let fillClass: string;
    let fillPct: number;
    if (koable) {
      fillClass = 'smash-ko-bar-fill--active';
      fillPct = Math.round((player.koableTicksRemaining / KOABLE_DURATION_TICKS) * 100);
    } else {
      fillClass = 'smash-ko-bar-fill--airborne';
      fillPct = 100;
    }

    return `
      <div class="smash-ko-bar-wrap">
        <span class="smash-ko-bar-label">KOable</span>
        <div class="smash-ko-bar-track">
          <div class="smash-ko-bar-fill ${fillClass}" style="width:${fillPct}%"></div>
        </div>
      </div>
    `;
  }

  private renderCard(player: PlayerRenderState): string {
    let healthPct: number;
    let colorRatio: number;
    if (this.gameMode === 'smash') {
      healthPct = Math.round(Math.max(0, player.damagePct));
      colorRatio = SMASH_MAX_DAMAGE_PCT > 0
        ? 1 - Math.min(1, Math.max(0, player.damagePct) / SMASH_MAX_DAMAGE_PCT)
        : 1;
    } else {
      healthPct =
        player.maxHealth > 0 ? Math.round((player.health / player.maxHealth) * 100) : 0;
      colorRatio = player.maxHealth > 0 ? player.health / player.maxHealth : 0;
    }
    const color = healthColor(colorRatio);
    const playerColor = colorToCss(player.color);

    let headshot = '';
    try {
      headshot = getCharacterSpriteUrl(
        player.characterId,
        `${player.characterId}_headshot`,
      );
    } catch {
      headshot = '';
    }

    const stocks = Math.max(0, player.stocks);
    let stockPips: string;
    if (stocks <= PIP_DISPLAY_THRESHOLD) {
      stockPips = Array.from({ length: stocks }, () =>
        `<span class="smash-stock-pip smash-stock-pip--filled"></span>`,
      ).join('');
    } else {
      stockPips = `<span class="smash-stock-pip smash-stock-pip--filled"></span><span class="smash-stock-count" style="color: white">× ${stocks}</span>`;
    }

    return `
      <div class="smash-card${player.eliminated ? ' smash-card--eliminated' : ''}">
        <div class="smash-card-portrait" style="background:${playerColor}">
          ${headshot ? `<img class="smash-card-headshot" src="${headshot}" alt="${player.characterId}" draggable="false" />` : ''}
        </div>
        <div class="smash-card-stats">
          <div class="smash-health-value" style="color:${color}">${healthPct}%</div>
          <div class="smash-stocks">${stockPips}</div>
          ${this.renderKoBar(player)}
        </div>
      </div>
    `;
  }
}
