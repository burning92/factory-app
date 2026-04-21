/** 로그인용 이메일 도메인 (실제 메일 아님) */
export const AUTH_EMAIL_SUFFIX = ".local";

/** profiles 테이블 행 (조회용) */
export interface Profile {
  id: string;
  organization_id: string;
  login_id: string;
  display_name: string | null;
  role: "worker" | "assistant_manager" | "manager" | "headquarters" | "admin";
  is_active: boolean;
  must_change_password: boolean;
}

/** organizations 테이블 행 (조회용) */
export interface Organization {
  id: string;
  organization_code: string;
  name: string;
  is_active: boolean;
}

/** organization_ui_settings 테이블 행 (조회용) */
export interface OrganizationUISettings {
  organization_id: string;
  logo_url: string | null;
  brand_name: string;
  primary_color: string | null;
  menu_config: MenuItemConfig[] | null;
  home_cards_config: unknown | null;
  default_landing_path: string | null;
}

/** 메뉴 항목 (menu_config 배열 요소) */
export interface MenuItemConfig {
  key: string;
  label: string;
  path: string;
  visible?: boolean;
}
