const yapi = require('../yapi.js');
const projectModel = require('../models/project.js');
const interfaceModel = require('../models/interface.js');
const mockExtra = require('../../common/mock-extra.js');
const _ = require('underscore');
const Mock = require('mockjs');


function matchApi(apiPath, apiRule) {
    let apiRules = apiRule.split("/");
    let apiPaths = apiPath.split("/");
    if (apiPaths.length !== apiRules.length) {
        return false;
    }
    for (let i = 0; i < apiRules.length; i++) {
        if (apiRules[i] && apiRules[i].indexOf(":") !== 0) {
            if (apiRules[i] !== apiPaths[i]) {
                return false;
            }
        }
    }
    return true;
}

function handleCorsRequest(ctx) {
    let header = ctx.request.header;
    ctx.set('Access-Control-Allow-Origin', header.origin);
    ctx.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, HEADER, PATCH, OPTIONS");
    ctx.set('Access-Control-Allow-Headers', header['access-control-request-headers']);
    ctx.set('Access-Control-Allow-Credentials', true);
    ctx.set('Access-Control-Max-Age', 1728000);
    ctx.body = 'ok';

}

module.exports = async (ctx, next) => {
    // no used variable 'hostname' & 'config'
    // let hostname = ctx.hostname;
    // let config = yapi.WEBCONFIG;
    let path = ctx.path;


    if (path.indexOf('/mock/') !== 0) {
        if (next) await next();
        return true;
    }

    let paths = path.split("/");
    let projectId = paths[2];
    paths.splice(0, 3);
    path = "/" + paths.join("/");
    if (!projectId) {
        return ctx.body = yapi.commons.resReturn(null, 400, 'projectId不能为空');
    }

    yapi.commons.log('MockServer Running...');
    let projectInst = yapi.getInst(projectModel), project;
    try {
        project = await projectInst.get(projectId);
    } catch (e) {
        return ctx.body = yapi.commons.resReturn(null, 403, e.message);
    }

    if (project === false) {
        return ctx.body = yapi.commons.resReturn(null, 400, '不存在的项目');
    }

    let interfaceData, newpath;
    let interfaceInst = yapi.getInst(interfaceModel);

    try {
        newpath = path.substr(project.basepath.length);
        interfaceData = await interfaceInst.getByPath(project._id, newpath, ctx.method);

        //处理query_path情况
        if (!interfaceData || interfaceData.length === 0) {
            interfaceData = await interfaceInst.getByQueryPath(project._id, newpath, ctx.method);

            let i, l, j, len, curQuery, match = false;
            for (i = 0, l = interfaceData.length; i < l; i++) {
                match = false;
                currentInterfaceData = interfaceData[i];
                curQuery = currentInterfaceData.query_path;
                if (!curQuery || typeof curQuery !== 'object' || !curQuery.path) {
                    continue;
                }
                for (j = 0, len = curQuery.params.length; j < len; j++) {
                    if (ctx.query[curQuery.params[j].name] !== curQuery.params[j].value) {
                        continue;
                    }
                    if (j === len - 1) {
                        match = true;
                    }
                }
                if (match) {
                    interfaceData = [currentInterfaceData];
                    break;
                }
                if (i === l - 1) {
                    interfaceData = [];
                }
            }
        }

        //处理动态路由
        if (!interfaceData || interfaceData.length === 0) {
            let newData = await interfaceInst.getVar(project._id, ctx.method);
            let findInterface = _.find(newData, (item) => {
                return matchApi(newpath, item.path)
            });

            if (!findInterface) {
                //非正常跨域预检请求回应
                if (ctx.method === 'OPTIONS' && ctx.request.header['access-control-request-method']) {
                    return handleCorsRequest(ctx);
                }
                return ctx.body = yapi.commons.resReturn(null, 404, `不存在的api, 当前请求path为 ${newpath}， 请求方法为 ${ctx.method} ，请确认是否定义此请求。`);
            }
            interfaceData = [
                await interfaceInst.get(findInterface._id)
            ]

        }

        if (interfaceData.length > 1) {
            return ctx.body = yapi.commons.resReturn(null, 405, '存在多个api，请检查数据库');
        } else {
            interfaceData = interfaceData[0];
        }

        ctx.set("Access-Control-Allow-Origin", "*")
        if (interfaceData.res_body_type === 'json') {
            try {
                let res = mockExtra(
                    yapi.commons.json_parse(interfaceData.res_body),
                    {
                        query: ctx.request.query,
                        body: ctx.request.body
                    }
                );
                res = Mock.mock(res);
                let context = {
                    projectData: project,
                    interfaceData: interfaceData,
                    ctx: ctx,
                    mockJson: res
                }
                await yapi.emitHook('mock_after', context);
                return ctx.body = context.mockJson;
            } catch (e) {
                yapi.commons.log(e, 'error')
                return ctx.body = {
                    errcode: 400,
                    errmsg: '解析出错，请检查。Error: ' + e.message,
                    data: null
                }
            }
        }
        return ctx.body = interfaceData.res_body;
    } catch (e) {
        console.error(e)
        return ctx.body = yapi.commons.resReturn(null, 409, e.message);
    }
};
