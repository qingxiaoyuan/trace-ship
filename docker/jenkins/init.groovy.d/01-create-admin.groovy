import jenkins.model.*
import hudson.security.*
import jenkins.install.InstallState

def instance = Jenkins.getInstance()
def env = System.getenv()

def adminUser = env.getOrDefault("JENKINS_ADMIN_USER", "admin")
def adminPassword = env.getOrDefault("JENKINS_ADMIN_PASSWORD", "Jenkins@2024")

// 禁用安装向导
if (instance.getInstallState().isSetupComplete()) {
    return
}
instance.setInstallState(InstallState.INITIAL_SETUP_COMPLETED)

// 创建安全域
def hudsonRealm = new HudsonPrivateSecurityRealm(false)
instance.setSecurityRealm(hudsonRealm)

// 创建管理员用户
def user = hudsonRealm.createAccount(adminUser, adminPassword)
user.save()

// 配置权限策略
def strategy = new FullControlOnceLoggedInAuthorizationStrategy()
strategy.setAllowAnonymousRead(false)
instance.setAuthorizationStrategy(strategy)

instance.save()

println "✅ Jenkins 管理员用户已创建: ${adminUser}"
