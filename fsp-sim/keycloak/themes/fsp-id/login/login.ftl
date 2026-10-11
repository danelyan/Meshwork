<#import "template.ftl" as layout>
<#import "field.ftl" as field>
<#import "buttons.ftl" as buttons>
<#import "social-providers.ftl" as identityProviders>
<#import "passkeys.ftl" as passkeys>
<#--
  Страница входа симулятора ФСП ID. Основа – login.ftl темы keycloak.v2 (Keycloak 26.5); добавлен блок
  для жюри: что это за страница и вход выбранным участником в одно нажатие (resources/js/quick-login.js
  берёт участников и общий демо-пароль у API реестра на том же адресе). Флажок «Запомнить меня» убран:
  платформа каждый раз просит войти заново.
-->
<@layout.registrationLayout displayMessage=!messagesPerField.existsError('username','password') displayInfo=realm.password && realm.registrationAllowed && !registrationDisabled??; section>
<!-- template: login.ftl (fsp-id) -->

    <#if section = "header">
        ${msg("loginAccountTitle")}
    <#elseif section = "form">
        <div id="fsp-sim" class="fsp-sim">
          <p class="fsp-sim__text"><span class="fsp-sim__badge">${msg("fspSimLead")}</span> ${msg("fspSimText")}</p>
          <div id="fsp-sim-quick" class="fsp-sim__quick" hidden>
            <p class="fsp-sim__title">${msg("fspSimQuick")}</p>
            <div id="fsp-sim-list" class="fsp-sim__list"></div>
            <p class="fsp-sim__note">${msg("fspSimQuickNote")} <a href="/" target="_blank" rel="noopener">${msg("fspSimHome")}</a></p>
          </div>
          <p id="fsp-sim-hint" class="fsp-sim__note">${msg("fspSimHint")} <a href="/" target="_blank" rel="noopener">${msg("fspSimHome")}</a></p>
          <p id="fsp-sim-manual" class="fsp-sim__divider" hidden><span>${msg("fspSimManual")}</span></p>
        </div>
        <div id="kc-form">
          <div id="kc-form-wrapper">
            <#if realm.password>
                <form id="kc-form-login" class="${properties.kcFormClass!}" onsubmit="login.disabled = true; return true;" action="${url.loginAction}" method="post" novalidate="novalidate">
                    <#if !usernameHidden??>
                        <#assign label>
                            <#if !realm.loginWithEmailAllowed>${msg("username")}<#elseif !realm.registrationEmailAsUsername>${msg("usernameOrEmail")}<#else>${msg("email")}</#if>
                        </#assign>
                        <@field.input name="username" label=label error=messagesPerField.getFirstError('username','password')
                            autofocus=true autocomplete="${(enableWebAuthnConditionalUI?has_content)?then('username webauthn', 'username')}" value=login.username!'' />
                        <@field.password name="password" label=msg("password") error="" forgotPassword=realm.resetPasswordAllowed autofocus=usernameHidden?? autocomplete="current-password" />
                    <#else>
                        <@field.password name="password" label=msg("password") forgotPassword=realm.resetPasswordAllowed autofocus=usernameHidden?? autocomplete="current-password" />
                    </#if>

                    <input type="hidden" id="id-hidden-input" name="credentialId" <#if auth.selectedCredential?has_content>value="${auth.selectedCredential}"</#if>/>
                    <@buttons.loginButton />
                </form>
            </#if>
            </div>
        </div>
        <@passkeys.conditionalUIData />
        <script type="module" src="${url.resourcesPath}/js/quick-login.js"></script>
    <#elseif section = "socialProviders" >
        <#if realm.password && social.providers?? && social.providers?has_content>
            <@identityProviders.show social=social/>
        </#if>
    <#elseif section = "info" >
        <#if realm.password && realm.registrationAllowed && !registrationDisabled??>
            <div id="kc-registration-container">
                <div id="kc-registration">
                    <span>${msg("noAccount")} <a href="${url.registrationUrl}">${msg("doRegister")}</a></span>
                </div>
            </div>
        </#if>
    </#if>

</@layout.registrationLayout>
