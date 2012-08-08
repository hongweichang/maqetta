define([
    "dojo/_base/declare",
	"dojo/_base/connect",
	"davinci/ui/ModelEditor",
	"davinci/ve/ThemeModifier",
	"davinci/ve/themeEditor/VisualThemeEditor",
	"davinci/ve/themeEditor/metadata/query",
	"davinci/ve/themeEditor/metadata/CSSThemeProvider",
	"davinci/ve/themeEditor/commands/ThemeEditorCommand",
	"davinci/ve/themeEditor/commands/SubwidgetChangeCommand",
	"davinci/ve/themeEditor/commands/StateChangeCommand",
	"dijit/layout/ContentPane",
	"davinci/commands/CompoundCommand",
	"davinci/ve/themeEditor/ThemeColor",
	"davinci/ve/utils/GeomUtils",
	"system/resource",
	"davinci/model/Path",
	], function(
			declare,
			connect,
			ModelEditor,
			ThemeModifier,
			VisualThemeEditor,
			query,
			CSSThemeProvider,
			ThemeEditorCommand,
			SubwidgetChangeCommand,
			StateChangeCommand,
			ContentPane,
			CompoundCommand,
			ThemeColor,
			GeomUtils,
			systemResource,
			Path
	){

return declare("davinci.ve.themeEditor.ThemeEditor", [ModelEditor/*, ThemeModifier*/], {
	
	children : [], //FIXME: shared array
	visualEditor : null, 
	_currentState: "Normal", // the state is for all the widgets on the page
	_dirtyResource : {},
	_subWidgetSelection:null,
	_theme:null,
	_tempRules : {}, // FIXME: shared object
	_subscriptions : [], // FIXME: shared array
	__DEBUG_TO_CONSOLE : false,
	_shortHands: ['border', 'padding', 'margin', 'background','font', 'list-style'],
	
	
	constructor: function (element) {
		
		this.inherited(arguments);
		var themeEditor = this;
		this.editorContainer = dijit.getEnclosingWidget(element);
		this._cp = new ContentPane({}, element);
		this.domNode = this._cp.domNode;
		this.domNode.className = "ThemeEditor fullPane";
		this._loadedCSSConnects = [];
		this.subscribe("/davinci/ui/editorSelected", this._editorSelected.bind(this));
		this.subscribe("/davinci/ui/context/loaded", this._contextLoaded.bind(this));
		this.subscribe("/maqetta/ui/actionPropertiesPalette/moved", this._actionPropertiesPaletteChanged.bind(this));
		this.subscribe("/maqetta/ui/actionPropertiesPalette/resized", this._actionPropertiesPaletteChanged.bind(this));
		this.subscribe("/maqetta/ui/actionPropertiesPalette/showProps", this._actionPropertiesPaletteChanged.bind(this));
		this.subscribe("/maqetta/ui/actionPropertiesPalette/hideProps", this._actionPropertiesPaletteChanged.bind(this));
		this.editorContainer.connect(this.editorContainer, 'resize', function(newPos){
			// "this" is the EditorContainer/ContentPane dijit
			var iframe = dojo.query('iframe', this.domNode)[0];
			if(iframe && iframe.contentDocument && iframe.contentDocument.body){
				var bodyElem = iframe.contentDocument.body;
				var context = this.editor.getContext();
				// Wrapped in setTimeout because sometimes browsers are quirky about
				// instantly updating the size/position values for elements
				// and things usually work if you wait for current processing thread
				// to complete. Also, updateFocusAll() can be safely called within setTimeout.
				setTimeout(function() {
					context.updateFocusAll(); 
				}, 100); 
				themeEditor._registerScrollHandler();
			}
		});
	},
	
	_editorSelected: function(event){
		var context = this.getContext();
		if(this == event.oldEditor){
			context.hideFocusAll();
		}
		if(event.editor && event.editor.editorContainer && 
				(event.editor.declaredClass == 'davinci.ve.PageEditor' ||
				event.editor.declaredClass == 'davinci.ve.themeEditor.ThemeEditor')){
			event.editor.editorContainer.showActionPropertiesPalette();
			if(this == event.editor){
				if(this.editorContainer && this.editorContainer.restoreActionPropertiesState){
					this.editorContainer.restoreActionPropertiesState(this)
				}
				this._registerScrollHandler();
			}
		}else{
			var editor = event.editor ? event.editor : event.oldEditor;
			if(editor){
				editor.editorContainer.hideActionPropertiesPalette();
			}
		}
	},

	_actionPropertiesPaletteChanged: function(){
		if(this == davinci.Runtime.currentEditor && this.editorContainer){
			this.editorContainer.preserveActionPropertiesState(this);
		}
	},
	
	onResize: function(){
		var context = this.getContext();
		var widget = this.getSelectedWidget();
		context.select(widget, false); // at least for V0.6 theme editor does not support multi select .select(widget, false); // at least for V0.6 theme editor does not support multi select 
	},
	
	getSelectionProperties: function(updateContext){
		if(!this._selectedWidget) {
			return [{editor:this, widget:null, subwidget:null, cssValues: null, computedCssValues:null, appliesTo:['theme'], context:this.context }];
		}
		
		 var v = this._getSelectionStyleValues(); 
		 var domNode;
			var rules = this._getCssRules();
			this._rebaseCssRuleImagesForStylePalette(rules, v);
		 
		 
		 var widgetType = this._selectedWidget.type;
		 var domNode = this._theme.getDomNode(this._selectedWidget.domNode, widgetType, this._selectedSubWidget);
		 var allStyle = dojo.getComputedStyle(domNode);
		 
		 return {editor:this, widget:this._selectedWidget, subwidget:this._selectedSubWidget, cssValues: v, computedCssValues:allStyle, appliesTo:['theme'], context:this.context};
		
	}, 


	_widgetStateChanged : function (e){
		if(!this.isActiveEditor() || !e) {
			return;
		}
		if (e.origin && e.origin.indexOf("davinci.ve.themeEditor.commands.")>-1){
			//then message was generated by undo or redo so bail.
			return;
		}
		/* #23 if (this._currentSelectionRules) {
			delete this._currentSelectionRules;
		}*/
		var widget = e.widget;
		if (widget && widget.processingUndoRedo){
			delete widget.processingUndoRedo; // this is a hack to get around the event firing on a undo from the outline view
			return;
		}

		this.getContext().getCommandStack().execute(new StateChangeCommand({_themeEditor: this,
			_widget: widget, _newState: e.newState, _oldState: e.oldState, _firstRun: true
		}));
		
		
	},
	
	selectSubwidget: function(widget, subwidget){
		if (!widget || !subwidget || subwidget == 'WidgetOuterContainer') { return; }
		var widgetType = this._theme.getWidgetType(widget);
		var domNode = this._theme.getDomNode(widget.domNode, widgetType, subwidget);
		
		var realleft =0;
		var realtop = 0;
		var obj = domNode;
		if (obj.offsetParent) {
			do {
			    if (obj.className.indexOf('theming-widget') > -1){
                    // #1024 using ralitve div for postion
                    realtop = domNode.offsetTop; // 1024
                    realleft = domNode.offsetLeft ; // 1024
                    break;
                }
				realleft += obj.offsetLeft;
				realtop += obj.offsetTop;
			} while (obj = obj.offsetParent);
		}
		var frame = this.getContext().getDocument().createElement("div");
		frame.className = "editSubwidgetFocusFrame";
		frame.id = "editSubwidgetFocusFrame";
		frame.style.position = "absolute";
		var padding = 2; // put some space between the subwidget and box
		frame.style.width = domNode.offsetWidth + (padding * 2) + "px";
		frame.style.height = domNode.offsetHeight + (padding * 2) + "px";
		realtop = realtop - padding;
		realleft = realleft - padding;
		frame.style.top = realtop + "px";
		frame.style.left = realleft + "px"; 
		frame.style.padding = padding + 'px';
		frame.style.display = "block";
		this._selectedWidget.domNode.parentNode.appendChild(frame);
		this._subWidgetFocusFrame = frame;

	},
	
	deselectSubwidget: function(widget, subwidget){
//		if (!widget || !subwidget) { return; }
		if (this._subWidgetFocusFrame){
			this._subWidgetFocusFrame.parentNode.removeChild(this._subWidgetFocusFrame);
			this._subWidgetFocusFrame = null;
		}

	},
	
	_subwidgetSelectionChanged: function (e){


//		if(!this.isActiveEditor() ||  !(this._selectedWidget || this._selectedSubWidget) ) return;
//
//		
//		this._selectedSubWidget = e.subwidget;
//		this.selectSubwidget(this._selectedWidget, this._selectedSubWidget);
//		dojo.publish("/davinci/ui/widgetSelected"[[this._selectedWidget]]);
		if (e.origin && e.origin.indexOf("davinci.ve.themeEditor.commands.")>-1){
			//then message was generated by undo or redo so bail.
			return;
		}
		/*#23 if (this._currentSelectionRules) {
			delete this._currentSelectionRules;
		}*/
	
		if(!this.isActiveEditor() ||  !(this._selectedWidget || this._selectedSubWidget) ) { return; }
		
		this.getContext().getCommandStack().execute(new SubwidgetChangeCommand({_themeEditor: this,
			_subwidget: e.subwidget
		}));
		
	},
	
	_getSelectionStyleValues: function (){
		//debugger;;
		
		var rules=this._getCssRules();
		if(rules.length==0) {
			return null;
		}
		var allProps = {};
		for(var s = 0; s < rules.length; s++){
			var rule=rules[s];
			for(var p = 0;p<rule.properties.length;p++){
				//if(!allProps[rule.properties[p].name]){ // set to first found
					allProps[rule.properties[p].name] = rule.properties[p].value;
				//}
			}
		}
		allProps = this.convertShortHandProps(allProps);
		return allProps;
	},
	
	addShortHandProps: function (values){
		var shortHands = this._shortHands;
		var styleStr = '';
		for (a in values){
			styleStr = styleStr + ' ' + a + ': ' + values[a] + ';';
		}
		var e = dojo.doc.createElement('div');
		e.style.cssText = styleStr;
//		for (var i = 0; i<shortHands.length; i++){
//			var sh = shortHands[i];
//			if (e.style[sh]){
//				values[sh] = e.style[sh];
//			}
//		}
		for (v in values){
			var name = dashedToCamel(v);
			if (e.style[name]){
				values[v] = e.style[name];
			}
		}

		return values;
		
		function dashedToCamel (str){
			return str.replace(/(\-[a-z])/g, function($1){return $1.toUpperCase().replace('-','');});
		}
	},
	
	convertShortHandProps: function (props){
		var shortHands = this._shortHands;
		//var shortHands = ['border', 'padding', 'margin', 'background','font', 'list-style'];
		for (var x = 0; x<shortHands.length; x++){
			var sh = shortHands[x];
			if(props[sh]){
				var e = dojo.doc.createElement('div');
				e.style.cssText = sh + ': '+ props[sh] + ';';
				var i = 0;
				for (n in e.style){
					if (n.indexOf(sh)>-1){
						var name = camelCaseToDashed(n);
						if (e.style[n])
							props[name]= e.style[n];
					}
				}
			}
		}
	
		function camelCaseToDashed(str){
			return str.replace(/([A-Z])/g, function($1){return "-"+$1.toLowerCase();});
		}

		
		
		function cssNameToJSName(val) {

	        var newVal = '';
	        val = val.split('-');
	        // do not upppercase first word
	        newVal += val[0].substring(0,1).toLowerCase() + val[0].substring(1,val[0].length);
	        for(var c=1; c < val.length; c++) {
	        	if(val[c] != 'value' )
	                newVal += val[c].substring(0,1).toUpperCase() + val[c].substring(1,val[c].length);
	        }
	        return newVal;
		}
		
		return props;
	},
	
	_getCssRules: function (widget, subWidget, state){
		//debugger;;
		/* #23 if (this._currentSelectionRules) {
			return this._currentSelectionRules;
		}*/
		if (!subWidget) { subWidget = null; }
		var selectors = this._loadCssSelectors(widget, subWidget, state);
		var rules = [];
		if(!selectors) {
			return null;
		}
		var allProps = {};
		for(var s = 0; s < selectors.length; s++){
			var cssFiles = this.getContext()._getCssFiles();
			if (cssFiles){
				for(var i = 0;i<cssFiles.length;i++){
					var selectorNodes = cssFiles[i].getRules(selectors[s]);
					for (sn = 0; sn < selectorNodes.length; sn++){
						var selectorNode = selectorNodes[sn];
						if(selectorNode){
							var rule = selectorNode.searchUp( "CSSRule");
							if(rule){
								rules.push(rule);
							}
						}
					}
				}
			}
		}
		/*#23 if (rules.length > 0) {
			this._currentSelectionRules = rules;
		}*/
		return rules;
	},
	
	focus : function (){
		
		this.onSelectionChange([this.getSelectedWidget()]);
		
	},
	supports : function (something){
		// Note: the propsect_* values need to match the keys in SwitchingStyleView.js
		var regex = /^style|states|propsect_layout|propsect_paddingMargins|propsect_background|propsect_border|propsect_fontsAndText$/;
		return something.match(regex) ? true : false;
	},
	
	onSelectionChange : function(a){

 		if(!this.isActiveEditor() || !a || !a[0]) { return; }
		if(this._selectedWidget && (this._selectedWidget.id == a[0].id)) {
			return; // the object is already selected, the only timeI have seen this is on a redo command
		}
		/* #23 if (this._currentSelectionRules) {
			delete this._currentSelectionRules;
		}*/
		this.getContext().getCommandStack().execute(new ThemeEditorCommand({_themeEditor: this,
			_widget: a, _firstRun: true

		}));


	},
	getSelectedWidget : function(){
		
		var context = this.getContext();
		
		var selection = context.getSelection();
		var widget = (selection.length > 0 ? selection[selection.length - 1] : undefined);
		if(selection.length > 1){
			context.select(widget);
		}
		return widget;
	},
	getSelectedSubWidget : function(){
		if(this._selectedSubWidget){
			return this._selectedSubWidget;
			
		}
	},
	
	_loadCssSelectors : function(widget, subWidget, state){
		//debugger;;
		var context = this.getContext();
		if (!widget){
			widget = this._selectedWidget;
			if (!subWidget){
				subWidget = this.getSelectedSubWidget();
			}
		}
		if(!widget) {
			return null;
		}
		
		var widgetType = this.metaDataLoader.getType(widget);
		
		if(!widgetType)
			return null;

		var id = widget.id;
		if(id.indexOf('all') === 0){ // this is a  mythical widget used for global change of widgets 
			widgetType = widgetType + '.$' + id; // add this to the end so it will match the key in the metadata
		}
		
		
		if (!state){
			state = this._currentState; // the state is for all the widgets on the page
		}
	
		if(!state)
			state = "Normal";
		var allClasses = [];
		if(this.__DEBUG_TO_CONSOLE) console.log("[theme editor] query metadata, widget: " + widget.declaredClass + " subwidget:" + subWidget  + " state:" + state);
		var metadata = this._theme.getStyleSelectors(widgetType,state,subWidget);
		
		for(var aa in metadata){
			
			allClasses.push(aa);
		}

		return allClasses; // wdr array of selectors

	},
	
	_addCommandsForValue : function(command, widget, subWidget, state, value, property){
		if (!command){
			command = new CompoundCommand();
		}
		var deltaRules = [];
		var rules = this.getRules(widget, subWidget, state);
		for (var r = 0; r < rules.length; r++){
			var rule = rules[r];
			if(/*!property ||*/ this._theme.isPropertyVaildForWidgetRule(rule,property,this._selectedWidget, subWidget, state)){
				var deltaRule = this.getContext().getDeltaRule(rule);
				deltaRules[deltaRule.getSelectorText()] = deltaRule;
				
			}
		}
		for (var dRule in deltaRules){
			var oldRule = value.appliesTo.rule; // save to put back 
			value.appliesTo.rule = null; //null to keep clone from throwing stack
			cValue = dojo.clone(value); // clone becouse the rule will change
			cValue.appliesTo.rule = deltaRules[dRule]; // create delta if needed #23
			value.appliesTo.rule = oldRule;
			// adjust the path of any url
			cValue.values.forEach(function(value){
				if(value[property] && value[property].indexOf("url('") == 0){
					/*
					 * The old rule may be in a differnt file than the delta rule
					 * So e need to update the realivie path to the file in realtion to 
					 * the CSS file the delta rule is in.
					 */
					// starts with url
					//find the resource
					var strArray = value[property].split("'"); // Becouse this comes from the property palette the format is always url('....')
					var url = strArray[1];
					if (url.indexOf('http://') > -1){
						// no need to adjust path.
						return;
					}
					var imageFilePath = oldRule.parent.url.substring(0, oldRule.parent.url.lastIndexOf("/")) + '/' + url;
					var file = systemResource.findResource(imageFilePath);
					var filePath = new Path(file.getPath());
					var relFilePath = filePath.relativeTo(cValue.appliesTo.rule.parent.url, true);
					value[property] = "url('"+relFilePath+"')";
				}
			}.bind(this));
			
			command.add(this.getContext().getCommandForStyleChange(cValue));
		}
		return command;
	},
	
    _propertiesChange : function (value){
 	
		if(!this.isActiveEditor()) { return; }
		var command = new CompoundCommand();
		if (this._selectedWidget.id === 'all'){
			var colorValues = [];
			//this._rules = [];
			this._oldValues = [];
			for(var i=0; i < value.values.length; i++){
				var arritem = value.values[i];
				for (var v in arritem){
					if (v.indexOf('color')> -1){
						colorValues[v] = arritem[v];
					}
				}
			}
			var widgetMetadata = this._theme.getMetadata(this._theme.getWidgetType(this._selectedWidget));
			for (var c in widgetMetadata.states){
				if (c != 'Normal'){
					var setColorValues = dojo.clone(colorValues);
					for (var prop in setColorValues){
						var nColor;
						var hColor;
						if (widgetMetadata.states.Normal.defaults && widgetMetadata.states.Normal.defaults.cssPropery)
							nColor = widgetMetadata.states.Normal.defaults.cssPropery[prop];
						if (widgetMetadata.states[c].defaults && widgetMetadata.states[c].defaults.cssPropery)
							hColor = widgetMetadata.states[c].defaults.cssPropery[prop];
						var color = setColorValues[prop];
						if(nColor && hColor && color){
							var baseColor = new ThemeColor(color);
							var calcColor = baseColor.calculateHighlightColor(nColor, hColor);
							setColorValues[prop] = calcColor.toHex();
							for(var i=0; i < value.values.length; i++){
								var values = value.values[i];
								for (name in values){
									if (setColorValues[name]){
										values[name] = setColorValues[name];
									}
								}
							}
							for(var i=0;i<value.values.length;i++){
								for(var a in value.values[i]){
									command = this._addCommandsForValue(command, this._selectedWidget, this._selectedSubWidget, c, value, a);
								}
							}
						} 
					}
				} else {
					//Normal
					for(var i=0;i<value.values.length;i++){
						for(var a in value.values[i]){
							command = this._addCommandsForValue(command, this._selectedWidget, this._selectedSubWidget, this._currentState, value, a);
						}
					}
				}
			}
		} else {
			for(var i=0;i<value.values.length;i++){
				for(var a in value.values[i]){
					command = this._addCommandsForValue(command, this._selectedWidget, this._selectedSubWidget, this._currentState, value, a);
				}
			}
						
		}

		if (this._selectedWidget){
			this.getContext().getCommandStack().execute(command);
		}
		this.setDirty(true);
	},
	

	
	_rebaseCssRuleImagesForStylePalette: function(rules, values){ // the style palete assumes the basedir for images user/. where css in relation to the file.
		//debugger;;
		if (!rules) { return values; }
		for (var r=0; r < rules.length; r++){
			var rule = rules[r];
			for(var a in values){
				var propValue = rule.getProperty(a);
				if (propValue){ // only rebase urls for this rule.
					var url=propValue.getURL();
					if (url)
						values[a] = url;
				}
			}
		}
		return values;
		
	},

	
	_markDirty : function (file){

		this._dirtyResource[file] = new Date().getTime();;
		this._srcChanged();
		
	},
	

	

	_srcChanged : function(){
		//this.isDirty=true;
		
		/* here's a huge hack to mark the .theme file as dirty when the source changes */
		if (!this.isDirty){ // only need to mark dirty once
			if (this._themeFileContent){ //only set if we have some content
				this.resourceFile.setContents(this._themeFileContent, true);
			}else {
				console.error('ThemeEditor.theme file content empty');
				this._themeFileContent = this.resourceFile.getContentSync();
			}
		}
		this.isDirty=true;
		
		this.lastModifiedTime=new Date().getTime();
		if (this.editorContainer)
			this.editorContainer.setDirty(true);
	},
	
	setDirty: function(dirty){
		this.isDirty = dirty;
		if (this.editorContainer)
			this.editorContainer.setDirty(dirty);
	},
	
	getContext : function (){
    	return this.visualEditor ? this.visualEditor.context : null;
    },
	
	getOutline : function (){
		return this.visualEditor.getOutline();
	},
	
	getPropertiesView : function (){
		return this.visualEditor.getPropertiesView();
	},
	getThemeFile : function(){
		return this.theme;
	},
	

	
	setContent : function (filename, content) {

		try{
			this._themePath=new davinci.model.Path(filename);
//			this._URLResolver = new davinci.ve.utils.URLResolver(filename);
			
			this.theme = dojo.isString(content)? dojo.fromJson(content) : content;
			this.theme.file = system.resource.findResource(filename);
			//dojo.connect(this.visualEditor, "onSelectionChange", this,"onSelectionChange");
			this.themeCssFiles = [];
			for(var i = 0;i<this.theme.files.length;i++){
				if(this.theme.files[i].indexOf(".css")>-1){
					this.themeCssFiles.push(this.theme.files[i]);
				}
			}
			
			/*
			 * resolve theme html in the user workspace.
			 */
			var themeHtmlResources = [];
			
			for(var y = 0;y<this.theme.themeEditorHtmls.length;y++){
				var absoluteLocation = this._themePath.getParentPath().append(this.theme.themeEditorHtmls[y]).toString();
				themeHtmlResources.push(system.resource.findResource(absoluteLocation));
				
			}

			this.visualEditor = new VisualThemeEditor(this, this._cp.domNode,filename, this.themeCssFiles, themeHtmlResources,this.theme);
			
			this.fileName = filename;
			
			/*
			 * resolve metadata in the user workspace.
			 */
			var metaResources = [];
			var context = this.getContext();
			context._themePath = this._themePath;
			context.themeCssFiles = this.themeCssFiles;
			for(var i = 0;i<this.theme.meta.length;i++){
				metaResources.push(context._getThemeResource(this.theme.meta[i]));
				
			}
			
			this.metaDataLoader = new query(metaResources);
			this._theme = new CSSThemeProvider(metaResources, this.theme);
			// connect to the css files, so we can update the canvas when the model changes
			var cssFiles = context._getCssFiles();	
			
			for (var i = 0; i < cssFiles.length; i++) {
				this._loadedCSSConnects.push(dojo.connect(cssFiles[i], 'onChange', context,'_themeChange'));

            }
			this._themeFileContent = this.resourceFile.getContentSync(); // get the content for use later when setting dirty. Timing issue

			var subs = this._subscriptions;
			subs.push(dojo.subscribe("/davinci/ui/styleValuesChange", this,
			        '_propertiesChange'));
			subs.push(dojo.subscribe("/davinci/states/state/changed", this,
			        '_widgetStateChanged'));
			subs.push(dojo.subscribe("/davinci/ui/subwidgetSelectionChanged",
			        this, '_subwidgetSelectionChanged'));
			dojo.connect(this.visualEditor, "onSelectionChange", this,
			        "onSelectionChange");
		}catch(e){
			alert("error loading:" + filename + e);
			//delete this.tabs;
		}
	},

	getDefaultContent : function (){
		/* a template file should be specified in the extension definition instead
		 * 
		 */
		//return this.visualEditor.getDefaultContent();
	},

	selectModel : function (selection){

	},
	getFileEditors : function(){
		function getVisitor(dirtyResources, urlResolver, results) {
			return {
				lookFor : dirtyResources,
				urlResolver : urlResolver,
				result : results,
				_getObject :function(resource, text, lastModified){	
					return {resourceFile: resource, getText : function(){ return text; }, lastModifiedTime:lastModified };
				},
				visit : function(node){
					if(node.elementType=="CSSFile"){
						for(var aa in this.lookFor){
							if(aa==node.url){
								var resource=  system.resource.findResource(aa);
							
								this.result.push(this._getObject(resource, node.getText({noComments:false}), this.lookFor[aa]  ));
								//delete this.lookFor[aa]; we dont want to delete on autosave
								break;
							}
						}
					}
				return (this.lookFor.length<=0);
				}
			
			};
			
		
			
		};
		var results = [];
		var cssFiles = this.getContext()._getCssFiles();
		var visitor = getVisitor(this._dirtyResource, this._URLResolver, results);
		if (cssFiles){
			for(var i=0;i<cssFiles.length;i++){
				cssFiles[i].visit(visitor);
			}
		}
		
		/* add the .theme file to the workingCopy resources so that its removed */
		
		results.push({
			resourceFile: this.resourceFile,
			getText: function(){ return this.resourceFile.getContentSync(); },
			lastModifiedTime: Date.now()
		});
		return results;
		
	},
	save : function (isWorkingCopy){

		this.getContext().saveDynamicCssFiles(this.getContext()._getCssFiles(), isWorkingCopy);
		if(!isWorkingCopy) {
			this.isDirty=false;
		}
		if (this.editorContainer && !isWorkingCopy) {
			this.editorContainer.setDirty(false);
		}

	},
	removeWorkingCopy: function(){
		/*this.removeWorkingCopyDynamicCssFiles(this.getContext()._getCssFiles());
		this.resourceFile.removeWorkingCopy();
		this.isDirty=false;*/
		
	},

	destroy : function ()	{
	    if(this._scrollHandler){
	    	dojo.disconnect(this._scrollHandler);
	    	this._scrollHandler = null;
	    }
		this.inherited(arguments);
		if(this.visualEditor) { this.visualEditor.destroy(); }
		this.getContext().destroy();
		this._subscriptions.forEach(function(item) {
			dojo.unsubscribe(item);
		});
		if (this._loadedCSSConnects) {
			dojo.forEach(this._loadedCSSConnects, dojo.disconnect);
			delete 	this._loadedCSSConnects;
		}
		delete this._tempRules;
	},
	
	getText : function () {
		return dojo.toJson(this.theme, true);		
	},
	
	disableWidget: function(widget) {
		if (!widget) { return; }

		var frame = this.getContext().getDocument().getElementById("enableWidgetFocusFrame_" + widget.id); 
		if (frame){
			frame.parentNode.removeChild(frame);
		}
		//create
		this._createFrame(widget, 'disableWidgetFocusFrame_', 'disableWidgetFocusFrame');
	},
	
	_createFrame: function(widget, id, className){
		if (!widget) { return; }
		var frame = this.getContext().getDocument().getElementById(id + widget.id); 
		if (frame){
			return; // frame already exists 
		}
		var domNode = widget;
		if (widget.domNode)
			domNode = widget.domNode;

		var frame = this.getContext().getDocument().createElement("div");
		//dojo.connect(frame, "onclick", this, "editFrame");
		
		dojo.connect(frame, "onmousedown", this, "editFrameOnMouseDown");
		var containerNode = this.getContext().getContainerNode(); // click in white space
		dojo.connect(containerNode, "onmousedown", this, "canvasOnMouseDown");// click in white space
		frame.className = className;
		frame.id = id + widget.id;
		frame.style.position = "absolute";
		var box = GeomUtils.getMarginBoxPageCoords(domNode);
		frame.style.top = box.t + "px";
		frame.style.left = box.l + "px";
		frame.style.width = box.w + "px";
		frame.style.height = box.h + "px";
		frame.style.display = "block";
		frame._widget = widget;
		domNode.parentNode.appendChild(frame);
	},
	
	canvasOnMouseDown: function(event){
		//console.log('ThemeEditor:canvasOnMouseDown');
		 // we should only get here when the canvas is clicked on, deslecting widget	
	    var t = davinci.ve.widget.getEnclosingWidget(event.target);
        if (event.target.id.indexOf('enableWidgetFocusFrame_') >-1){
            t = event.target._widget;
        }
        var widget =  t ;
        while(widget){
            if (widget.dvAttributes && widget.dvAttributes.isThemeWidget && widget.getContext() ){ // managed widget
                return; // break;
            }
            widget = davinci.ve.widget.getEnclosingWidget(widget.domNode.parentNode);
        }
        

		if (this._selectedWidget && (event.target.className.indexOf('editFeedback') < 0)){ // #1024 mobile widgets click through
			event.stopPropagation();
			var a = [null];
			/*#23 if (this._currentSelectionRules) {
				delete this._currentSelectionRules;
			}*/
			this.getContext().getCommandStack().execute(new ThemeEditorCommand({_themeEditor: this,
				_widget: a, _firstRun: true

			}));
			this.getContext().select(null, false);


		}
	},
	
	editFrameOnMouseDown: function(event){
		event.stopPropagation(); 
		if(this.getContext()._activeTool && this.getContext()._activeTool.onMouseDown){
			this.getContext()._activeTool.onMouseDown(event);
		}
	},
	
	enableWidget: function(widget){

		if (!widget) { return; }
		var domNode = widget;
		if (widget.domNode) {
			domNode = widget.domNode;
		}
		var frame = this.getContext().getDocument().getElementById("disableWidgetFocusFrame_" + widget.id); 
		if (frame){
			frame.parentNode.removeChild(frame);
		}
		this._createFrame(widget, 'enableWidgetFocusFrame_', 'enableWidgetFocusFrame');
	},
	
	getRules: function(widget, subwidget, state){

		var selectors = this._loadCssSelectors(widget, subwidget, state);
		var rules = [];
		for (var s = 0; s < selectors.length; s++) {
			var modified = false;
			var cssFiles = this.getContext()._getCssFiles();
			if (cssFiles){
				for(var i = 0;i<cssFiles.length;i++){
					var selectorNodes = cssFiles[i].getRules(selectors[s]);
					for (var sn = 0; sn < selectorNodes.length; sn++){
						var selectorNode = selectorNodes[sn];
						if(selectorNode){
							var rule = selectorNode.searchUp( "CSSRule");
							if(rule){
								rules.push(rule);
								modified = true;
							}
						}
					}
				}
			}
			if(!modified){
				console.warn("[theme editor getRule] Rule not found in theme: " + selectors[s]);
			}
		}
		return rules;
	},
	
	_contextLoaded: function(context){
		if(context == this.getContext()){
			this._registerScrollHandler();
		}
	},

	_registerScrollHandler: function(){
		var context = this.getContext();
		if(!this._scrollHandler){
			var editorContainer = this.editorContainer;
			var iframe = dojo.query('iframe', editorContainer.domNode)[0];
			if(iframe && iframe.contentDocument && iframe.contentDocument.body){
				var bodyElem = iframe.contentDocument.body;
				this._scrollHandler = dojo.connect(iframe.contentDocument, 'onscroll', this, function(e){
					// (See setTimeout comment a few lines earlier)
					setTimeout(function() {
						context.updateFocusAll(); 
					}, 100); 
				});
			}
		}
	}


});
});
