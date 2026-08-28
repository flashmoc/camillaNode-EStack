class savedConfigs {
    configs;

    ///////////////////////////////////////////////// Local Implementations ////////////////////////////////////

    loadConfigsLocal(type, sorted) {
        if (sorted === undefined) sorted = false;

        this.configs = window.localStorage.getItem("savedConfigs");
        if (this.configs == null || this.configs.length === 0) this.configs = [];
        else this.configs = JSON.parse(this.configs);

        try {
            if (type != undefined && type != null) this.configs = this.configs.filter(e => e.type == type);
        } catch (_) {
            return [];
        }

        if (sorted) this.configs.sort((a, b) => a.name > b.name ? 1 : -1);
        return this.configs;
    }

    getConfigLocal(name, type) {
        if (this.configs === undefined) this.loadConfigsLocal();
        const filteredList = type === undefined
            ? this.configs.filter(e => e.name == name)
            : this.configs.filter(e => e.name == name && e.type == type);

        if (filteredList.length === 0) return { success: false, elementCount: 0 };
        if (filteredList.length > 1) return { success: false, elementCount: filteredList.length };
        return { success: true, elementId: filteredList[0].id };
    }

    getConfigByIdLocal(id) {
        if (this.configs === undefined) this.loadConfigsLocal();
        return this.configs.find(e => String(e.id) === String(id));
    }

    saveConfigLocal(config, overwrite) {
        if (this.configs === undefined) this.loadConfigsLocal();
        const getConfig = this.getConfigLocal(config.name, config.type);

        if (getConfig.success && overwrite) {
            this.deleteLocal(getConfig.elementId);
            this.addLocal(config);
            return [true, config];
        }
        if (getConfig.success && !overwrite) return [false, "exists"];
        if (getConfig.elementCount > 1) return [false, "multiple"];
        if (getConfig.elementCount === 0) {
            this.addLocal(config);
            return [true, config];
        }
        return getConfig;
    }

    addLocal(config) {
        if (this.configs === undefined) this.loadConfigsLocal();
        config.id = Date.now();
        this.configs.push(config);
        window.localStorage.setItem("savedConfigs", JSON.stringify(this.configs));
    }

    deleteLocal(id) {
        if (this.configs === undefined) this.loadConfigsLocal();
        const index = this.configs.findIndex(e => String(e.id) === String(id));
        if (index < 0) return false;
        this.configs.splice(index, 1);
        window.localStorage.setItem("savedConfigs", JSON.stringify(this.configs));
        return true;
    }

    saveLastConfigLocal(configName) {
        window.localStorage.setItem("lastConfigName", configName);
        return true;
    }

    getLastConfigLocal() {
        return window.localStorage.getItem("lastConfigName");
    }

    //////////////////////////////////////////////////// Remote Implementations //////////////////////////////////////////////

    async _writeRemote(configs) {
        const response = await fetch('/saveConfigFile', {
            method: "POST",
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(configs)
        });
        if (!response.ok) throw new Error(`Configuration save failed (${response.status})`);
        return true;
    }

    async loadConfigsRemote(type, sorted) {
        if (sorted === undefined) sorted = false;
        const response = await fetch('/getConfigFile', { cache: 'no-store' });
        if (!response.ok) throw new Error(`Configuration load failed (${response.status})`);

        const data = await response.text();
        let all = [];
        if (data.length > 0) {
            try {
                const parsed = JSON.parse(data);
                if (Array.isArray(parsed)) all = parsed;
            } catch (_) {
                all = [];
            }
        }

        // Keep the complete remote collection internally. Returning a filtered
        // copy avoids the old bug where opening one page discarded other page
        // presets from this.configs before the next save.
        this.configs = all;
        let result = [...all];
        if (type != undefined && type != null) result = result.filter(e => e.type == type);
        if (sorted) result.sort((a, b) => a.name > b.name ? 1 : -1);
        return result;
    }

    async getConfigRemote(name, type) {
        await this.loadConfigsRemote();
        const filteredList = type === undefined
            ? this.configs.filter(e => e.name == name)
            : this.configs.filter(e => e.name == name && e.type == type);

        if (filteredList.length === 0) return { success: false, elementCount: 0 };
        if (filteredList.length > 1) return { success: false, elementCount: filteredList.length };
        return { success: true, elementId: filteredList[0].id };
    }

    async getConfigByIdRemote(id) {
        await this.loadConfigsRemote();
        return this.configs.find(e => String(e.id) === String(id));
    }

    async saveConfigRemote(config, overwrite = false) {
        await this.loadConfigsRemote();
        const existingIndex = this.configs.findIndex(e => e.name === config.name && e.type === config.type);

        if (existingIndex >= 0 && !overwrite) throw [false, "exists"];
        if (existingIndex >= 0) {
            const existingId = this.configs[existingIndex].id;
            config.id = existingId;
            this.configs.splice(existingIndex, 1, config);
        } else {
            config.id = Date.now();
            this.configs.push(config);
        }

        await this._writeRemote(this.configs);
        return [true, config];
    }

    async addRemote(config) {
        await this.loadConfigsRemote();
        config.id = config.id || Date.now();
        this.configs.push(config);
        await this._writeRemote(this.configs);
        return true;
    }

    async deleteRemote(id) {
        await this.loadConfigsRemote();
        const index = this.configs.findIndex(e => String(e.id) === String(id));
        if (index < 0) return false;
        this.configs.splice(index, 1);
        await this._writeRemote(this.configs);
        return true;
    }
}

export default savedConfigs;
